import fs = require('node:fs');
import path = require('node:path');
import ts = require('typescript');

const PACKAGE_NAME = '@nestm/standard-schema';
const PACKAGE_SWAGGER_SUBPATH = '@nestm/standard-schema/swagger';
const NEST_COMMON_PACKAGE = '@nestjs/common';
const NEST_SWAGGER_PACKAGE = '@nestjs/swagger';
const DEFAULT_CONTROLLER_FILE_NAME_SUFFIX = [
  '.controller.ts',
  '.controller.mts',
] as const;
const ROUTE_DECORATORS = new Set([
  'All',
  'Copy',
  'Delete',
  'Get',
  'Head',
  'Lock',
  'Mkcol',
  'Move',
  'Options',
  'Patch',
  'Post',
  'Propfind',
  'Proppatch',
  'Put',
  'RequestMapping',
  'Search',
  'Sse',
  'Unlock',
]);
const NEST_RESPONSE_DECORATORS = new Set(['SerializeOptions']);
const PACKAGE_RESPONSE_DECORATORS = new Set(['StandardSchemaResponse']);
const PACKAGE_SWAGGER_RESPONSE_DECORATORS = new Set([
  'ApiStandardSchemaResponse',
]);
const REQUEST_DECORATORS = new Set(['Body', 'Param', 'Query']);
const RAW_RESPONSE_DECORATORS = new Set(['Res', 'Response']);
const SWAGGER_RESPONSE_STATUS = new Map<string, number>([
  ['ApiOkResponse', 200],
  ['ApiCreatedResponse', 201],
  ['ApiAcceptedResponse', 202],
  ['ApiNonAuthoritativeInformationResponse', 203],
  ['ApiNoContentResponse', 204],
  ['ApiResetContentResponse', 205],
  ['ApiPartialContentResponse', 206],
  ['ApiMultiStatusResponse', 207],
  ['ApiAlreadyReportedResponse', 208],
  ['ApiImUsedResponse', 226],
]);
const EXPLICIT_SWAGGER_CONTRACT_PROPERTIES = new Set([
  'content',
  'schema',
  'standardSchema',
  'type',
]);
const packageNameByDirectory = new Map<string, string | undefined>();

type AmbiguousBehavior = 'error' | 'skip';

interface StandardSchemaPluginOptions {
  readonly controllerFileNameSuffix: readonly string[];
  readonly onAmbiguous: AmbiguousBehavior;
  readonly swagger: boolean;
}

interface DecoratorIdentity {
  readonly moduleSpecifier: string | undefined;
  readonly name: string;
}

interface DtoReference {
  readonly classSymbol: ts.Symbol;
  readonly expression: ts.Expression;
}

type ReturnAnalysis =
  | {
      readonly kind: 'infer';
      readonly isArray: boolean;
      readonly reference: DtoReference;
      readonly status: number | undefined;
    }
  | {
      readonly kind: 'skip';
    };

type RequestAnalysis =
  | {
      readonly kind: 'infer';
      readonly decorator: ts.Decorator;
      readonly reference: DtoReference;
    }
  | {
      readonly kind: 'skip';
    };

interface HelperUsage {
  root: boolean;
  swagger: boolean;
}

type SwaggerResponseMetadataAnalysis =
  | {
      readonly kind: 'infer';
      readonly hasExplicitContract: boolean;
      readonly target: ts.Decorator | undefined;
    }
  | {
      readonly kind: 'skip';
    };

/**
 * Nest CLI compiler plugin entry.
 *
 * The CLI loads this file synchronously with `require()`, which is why the
 * source uses `.cts` while the package's runtime entry remains ESM.
 */
function before(
  rawOptions: Record<string, unknown> = {},
  program?: ts.Program,
): ts.TransformerFactory<ts.SourceFile> {
  const options = parseOptions(rawOptions);

  if (program === undefined) {
    throw new Error(
      `${PACKAGE_NAME}/plugin requires the Nest tsc builder to provide a TypeScript Program.`,
    );
  }

  const checker = program.getTypeChecker();

  preflightProgram(program, checker, options);

  return (context) => {
    return (sourceFile) => {
      if (
        sourceFile.isDeclarationFile ||
        !matchesControllerSuffix(
          sourceFile.fileName,
          options.controllerFileNameSuffix,
        )
      ) {
        return sourceFile;
      }

      return transformControllerFile(sourceFile, context, checker, options);
    };
  };
}

function preflightProgram(
  program: ts.Program,
  checker: ts.TypeChecker,
  options: StandardSchemaPluginOptions,
): void {
  const requestErrors: Error[] = [];
  const responseErrors: Error[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (
      sourceFile.isDeclarationFile ||
      !matchesControllerSuffix(
        sourceFile.fileName,
        options.controllerFileNameSuffix,
      )
    ) {
      continue;
    }

    for (const statement of sourceFile.statements) {
      if (
        !ts.isClassDeclaration(statement) ||
        hasModifier(statement, ts.SyntaxKind.AbstractKeyword) ||
        !hasDecorator(
          statement,
          checker,
          new Set(['Controller']),
          NEST_COMMON_PACKAGE,
        )
      ) {
        continue;
      }

      const classHasExplicitResponse = hasExplicitResponseDecorator(
        statement,
        checker,
      );

      for (const member of statement.members) {
        if (
          !ts.isMethodDeclaration(member) ||
          member.body === undefined ||
          !hasDecorator(member, checker, ROUTE_DECORATORS, NEST_COMMON_PACKAGE)
        ) {
          continue;
        }

        if (options.swagger) {
          for (const parameter of member.parameters) {
            try {
              analyzeRequestParameter(
                parameter,
                member,
                statement,
                sourceFile,
                checker,
                options,
                new ImportPlanner(ts.factory),
              );
            } catch (error: unknown) {
              requestErrors.push(toError(error));
            }
          }
        }

        if (
          classHasExplicitResponse ||
          hasExplicitResponseDecorator(member, checker) ||
          hasRawResponseParameter(member, checker) ||
          isNoContentRoute(member, checker) ||
          member.type === undefined
        ) {
          continue;
        }

        try {
          const analysis = analyzeReturnType(
            member.type,
            member,
            statement,
            sourceFile,
            checker,
            options,
            new ImportPlanner(ts.factory),
          );

          if (analysis.kind === 'infer' && options.swagger) {
            analyzeSwaggerResponseMetadata(
              member,
              analysis,
              sourceFile,
              checker,
              options,
            );
          }
        } catch (error: unknown) {
          responseErrors.push(toError(error));
        }
      }
    }
  }

  const errors = [...requestErrors, ...responseErrors];

  if (errors.length === 0) {
    return;
  }

  const kind =
    requestErrors.length > 0 && responseErrors.length > 0
      ? 'request/response'
      : requestErrors.length > 0
        ? 'request'
        : 'response';

  throw new Error(
    [
      `${PACKAGE_NAME}/plugin found ${errors.length} ambiguous ${kind} contract${errors.length === 1 ? '' : 's'}:`,
      ...errors.map((error) => `- ${error.message}`),
    ].join('\n'),
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function parseOptions(
  rawOptions: Record<string, unknown>,
): StandardSchemaPluginOptions {
  const rawSuffix = rawOptions['controllerFileNameSuffix'];
  const rawOnAmbiguous = rawOptions['onAmbiguous'];
  const rawSwagger = rawOptions['swagger'];

  let controllerFileNameSuffix: readonly string[] =
    DEFAULT_CONTROLLER_FILE_NAME_SUFFIX;

  if (rawSuffix !== undefined) {
    if (
      !Array.isArray(rawSuffix) ||
      rawSuffix.length === 0 ||
      !rawSuffix.every(
        (suffix): suffix is string =>
          typeof suffix === 'string' && suffix.length > 0,
      )
    ) {
      throw new TypeError(
        `${PACKAGE_NAME}/plugin option "controllerFileNameSuffix" must be a non-empty string array.`,
      );
    }

    controllerFileNameSuffix = rawSuffix;
  }

  if (
    rawOnAmbiguous !== undefined &&
    rawOnAmbiguous !== 'error' &&
    rawOnAmbiguous !== 'skip'
  ) {
    throw new TypeError(
      `${PACKAGE_NAME}/plugin option "onAmbiguous" must be "error" or "skip".`,
    );
  }

  if (rawSwagger !== undefined && typeof rawSwagger !== 'boolean') {
    throw new TypeError(
      `${PACKAGE_NAME}/plugin option "swagger" must be a boolean.`,
    );
  }

  return {
    controllerFileNameSuffix,
    onAmbiguous: rawOnAmbiguous ?? 'error',
    swagger: rawSwagger ?? false,
  };
}

function matchesControllerSuffix(
  fileName: string,
  suffixes: readonly string[],
): boolean {
  return suffixes.some((suffix) => fileName.endsWith(suffix));
}

function transformControllerFile(
  sourceFile: ts.SourceFile,
  context: ts.TransformationContext,
  checker: ts.TypeChecker,
  options: StandardSchemaPluginOptions,
): ts.SourceFile {
  const importPlanner = new ImportPlanner(context.factory);
  const rootNamespaceIdentifier = context.factory.createIdentifier(
    findAvailableIdentifier(sourceFile, '_nestmStandardSchema'),
  );
  const swaggerNamespaceIdentifier = context.factory.createIdentifier(
    findAvailableIdentifier(sourceFile, '_nestmStandardSchemaSwagger'),
  );
  const helperUsage: HelperUsage = {
    root: false,
    swagger: false,
  };
  let changedMethodCount = 0;

  const statements = sourceFile.statements.map((statement) => {
    if (
      !ts.isClassDeclaration(statement) ||
      hasModifier(statement, ts.SyntaxKind.AbstractKeyword) ||
      !hasDecorator(
        statement,
        checker,
        new Set(['Controller']),
        NEST_COMMON_PACKAGE,
      )
    ) {
      return statement;
    }

    const classHasExplicitResponse = hasExplicitResponseDecorator(
      statement,
      checker,
    );
    const members = statement.members.map((member) => {
      if (!ts.isMethodDeclaration(member) || member.body === undefined) {
        return member;
      }

      const updatedMethod = transformRouteMethod(
        member,
        statement,
        classHasExplicitResponse,
        sourceFile,
        context.factory,
        checker,
        options,
        importPlanner,
        rootNamespaceIdentifier,
        swaggerNamespaceIdentifier,
        helperUsage,
      );

      if (updatedMethod !== member) {
        changedMethodCount += 1;
      }

      return updatedMethod;
    });

    return context.factory.updateClassDeclaration(
      statement,
      statement.modifiers,
      statement.name,
      statement.typeParameters,
      statement.heritageClauses,
      members,
    );
  });

  if (changedMethodCount === 0) {
    return sourceFile;
  }

  const updatedImports = importPlanner.apply(statements);
  const helperImports: ts.ImportDeclaration[] = [];

  if (helperUsage.root) {
    helperImports.push(
      createNamespaceImport(
        context.factory,
        rootNamespaceIdentifier,
        PACKAGE_NAME,
      ),
    );
  }

  if (helperUsage.swagger) {
    helperImports.push(
      createNamespaceImport(
        context.factory,
        swaggerNamespaceIdentifier,
        PACKAGE_SWAGGER_SUBPATH,
      ),
    );
  }

  return context.factory.updateSourceFile(sourceFile, [
    ...helperImports,
    ...updatedImports,
  ]);
}

function createNamespaceImport(
  factory: ts.NodeFactory,
  identifier: ts.Identifier,
  moduleSpecifier: string,
): ts.ImportDeclaration {
  return factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      undefined,
      factory.createNamespaceImport(identifier),
    ),
    factory.createStringLiteral(moduleSpecifier),
    undefined,
  );
}

function transformRouteMethod(
  method: ts.MethodDeclaration,
  controller: ts.ClassDeclaration,
  classHasExplicitResponse: boolean,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
  checker: ts.TypeChecker,
  options: StandardSchemaPluginOptions,
  importPlanner: ImportPlanner,
  rootNamespaceIdentifier: ts.Identifier,
  swaggerNamespaceIdentifier: ts.Identifier,
  helperUsage: HelperUsage,
): ts.MethodDeclaration {
  if (!hasDecorator(method, checker, ROUTE_DECORATORS, NEST_COMMON_PACKAGE)) {
    return method;
  }

  const parameters = options.swagger
    ? method.parameters.map((parameter) =>
        transformRequestParameter(
          parameter,
          method,
          controller,
          sourceFile,
          factory,
          checker,
          options,
          importPlanner,
        ),
      )
    : method.parameters;
  let decorators = [...getDecorators(method)];
  let inferredResponseDecorator: ts.Decorator | undefined;
  let rewroteResponseDecorator = false;

  // A method carrying `@StandardSchemaResponse` already declares its contract, so the inference
  // below skips it — but that decorator is `@SerializeOptions` under the hood and emits no
  // Swagger metadata, leaving the route documented with no response schema at all. Upgrade it to
  // the documented form, which serializes identically. Methods that already carry
  // `@ApiStandardSchemaResponse` are left untouched: they are documented by hand.
  if (
    options.swagger &&
    !hasDecorator(
      method,
      checker,
      PACKAGE_SWAGGER_RESPONSE_DECORATORS,
      PACKAGE_SWAGGER_SUBPATH,
    ) &&
    // The status must be knowable. A raw `@Res()` hands status control to the handler body, and a
    // redirect route ignores `@HttpCode` outright — both are populations the inference path
    // already refuses to guess for, and guessing here would be worse than saying nothing.
    !hasRawResponseParameter(method, checker) &&
    !isRedirectRoute(method, checker) &&
    !isNoContentRoute(method, checker) &&
    !hasSwaggerResponseDecorator(method, checker)
  ) {
    const upgradable = findUpgradableResponseDecorator(method, checker);
    const status = resolveRewriteResponseStatus(
      method,
      sourceFile,
      checker,
      options,
    );

    // `undefined` means the status could not be resolved statically, and 204 must never carry a
    // body. Both leave the decorator exactly as written rather than falling back: a status-less
    // rewrite reintroduces the `default`-key bug, and `?? 200` fabricates. Emitting nothing is
    // safe — with no response metadata at all, Swagger's own explorer falls back to the correct
    // 200/201 key, which is strictly better than the `default` entry that suppresses it.
    if (upgradable !== undefined && status !== undefined && status !== 204) {
      helperUsage.swagger = true;
      rewroteResponseDecorator = true;
      const documented = factory.createDecorator(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            swaggerNamespaceIdentifier,
            'ApiStandardSchemaResponse',
          ),
          undefined,
          [
            upgradable.source,
            // Status only. `isArray` would need return-type analysis the rewrite does not do, and
            // the author's source may already be an array schema — `getSwaggerResponseSchema`
            // would double-wrap it.
            factory.createObjectLiteralExpression(
              [
                factory.createPropertyAssignment(
                  'status',
                  factory.createNumericLiteral(status),
                ),
              ],
              false,
            ),
          ],
        ),
      );
      decorators = decorators.map((decorator) =>
        decorator === upgradable.decorator ? documented : decorator,
      );
    }
  }

  if (
    !classHasExplicitResponse &&
    !hasExplicitResponseDecorator(method, checker) &&
    !hasRawResponseParameter(method, checker) &&
    !isNoContentRoute(method, checker) &&
    method.type !== undefined
  ) {
    const analysis = analyzeReturnType(
      method.type,
      method,
      controller,
      sourceFile,
      checker,
      options,
      importPlanner,
    );

    if (analysis.kind === 'infer') {
      if (options.swagger) {
        const swaggerMetadata = analyzeSwaggerResponseMetadata(
          method,
          analysis,
          sourceFile,
          checker,
          options,
        );

        if (swaggerMetadata.kind === 'skip') {
          helperUsage.root = true;
          inferredResponseDecorator = createResponseDecorator(
            factory,
            rootNamespaceIdentifier,
            'StandardSchemaResponse',
            analysis,
            false,
          );
        } else if (
          swaggerMetadata.target === undefined ||
          !swaggerMetadata.hasExplicitContract
        ) {
          helperUsage.swagger = true;
          inferredResponseDecorator = createResponseDecorator(
            factory,
            swaggerNamespaceIdentifier,
            'ApiStandardSchemaResponse',
            analysis,
            true,
          );
        } else {
          helperUsage.root = true;
          inferredResponseDecorator = createResponseDecorator(
            factory,
            rootNamespaceIdentifier,
            'StandardSchemaResponse',
            analysis,
            false,
          );
        }
      } else {
        helperUsage.root = true;
        inferredResponseDecorator = createResponseDecorator(
          factory,
          rootNamespaceIdentifier,
          'StandardSchemaResponse',
          analysis,
          false,
        );
      }
    }
  }

  const parametersChanged = parameters.some(
    (parameter, index) => parameter !== method.parameters[index],
  );

  if (
    inferredResponseDecorator === undefined &&
    !parametersChanged &&
    !rewroteResponseDecorator
  ) {
    return method;
  }

  const modifiers = ts.getModifiers(method) ?? [];

  return factory.updateMethodDeclaration(
    method,
    [
      ...(inferredResponseDecorator === undefined
        ? []
        : [inferredResponseDecorator]),
      ...decorators,
      ...modifiers,
    ],
    method.asteriskToken,
    method.name,
    method.questionToken,
    method.typeParameters,
    parameters,
    method.type,
    method.body,
  );
}

function createResponseDecorator(
  factory: ts.NodeFactory,
  namespaceIdentifier: ts.Identifier,
  name: 'ApiStandardSchemaResponse' | 'StandardSchemaResponse',
  analysis: Extract<ReturnAnalysis, { readonly kind: 'infer' }>,
  includeSwaggerOptions: boolean,
): ts.Decorator {
  const arguments_: ts.Expression[] = [analysis.reference.expression];

  if (includeSwaggerOptions) {
    arguments_.push(
      factory.createObjectLiteralExpression(
        [
          factory.createPropertyAssignment(
            'status',
            factory.createNumericLiteral(analysis.status ?? 200),
          ),
          ...(analysis.isArray
            ? [
                factory.createPropertyAssignment(
                  'isArray',
                  factory.createTrue(),
                ),
              ]
            : []),
        ],
        false,
      ),
    );
  }

  return factory.createDecorator(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(namespaceIdentifier, name),
      undefined,
      arguments_,
    ),
  );
}

function transformRequestParameter(
  parameter: ts.ParameterDeclaration,
  method: ts.MethodDeclaration,
  controller: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  factory: ts.NodeFactory,
  checker: ts.TypeChecker,
  options: StandardSchemaPluginOptions,
  importPlanner: ImportPlanner,
): ts.ParameterDeclaration {
  const analysis = analyzeRequestParameter(
    parameter,
    method,
    controller,
    sourceFile,
    checker,
    options,
    importPlanner,
  );

  if (analysis.kind === 'skip') {
    return parameter;
  }

  const decoratorExpression = analysis.decorator.expression;

  if (!ts.isCallExpression(decoratorExpression)) {
    return parameter;
  }

  const schemaOptions = factory.createObjectLiteralExpression(
    [
      factory.createPropertyAssignment(
        'schema',
        factory.createPropertyAccessExpression(
          analysis.reference.expression,
          'schema',
        ),
      ),
    ],
    false,
  );
  const updatedDecorator = factory.updateDecorator(
    analysis.decorator,
    factory.updateCallExpression(
      decoratorExpression,
      decoratorExpression.expression,
      decoratorExpression.typeArguments,
      [schemaOptions],
    ),
  );
  const decorators = getDecorators(parameter).map((decorator) =>
    decorator === analysis.decorator ? updatedDecorator : decorator,
  );
  const modifiers = ts.getModifiers(parameter) ?? [];

  return factory.updateParameterDeclaration(
    parameter,
    [...decorators, ...modifiers],
    parameter.dotDotDotToken,
    parameter.name,
    parameter.questionToken,
    parameter.type,
    parameter.initializer,
  );
}

function analyzeRequestParameter(
  parameter: ts.ParameterDeclaration,
  method: ts.MethodDeclaration,
  controller: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  options: StandardSchemaPluginOptions,
  importPlanner: ImportPlanner,
): RequestAnalysis {
  if (parameter.type === undefined) {
    return { kind: 'skip' };
  }

  const requestDecorators = getDecorators(parameter).filter((decorator) =>
    decoratorMatches(
      decorator,
      checker,
      REQUEST_DECORATORS,
      NEST_COMMON_PACKAGE,
    ),
  );

  if (requestDecorators.length === 0) {
    return { kind: 'skip' };
  }

  const declaredType = unwrapResponseType(parameter.type);
  const containsDto = containsRequestDto(declaredType, checker);

  if (requestDecorators.length > 1) {
    return containsDto
      ? ambiguousRequest(
          options,
          parameter,
          method,
          sourceFile,
          'multiple request parameter decorators cannot infer one schema',
        )
      : { kind: 'skip' };
  }

  const decorator = requestDecorators[0];

  if (decorator === undefined || !ts.isCallExpression(decorator.expression)) {
    return containsDto
      ? ambiguousRequest(
          options,
          parameter,
          method,
          sourceFile,
          'request schema inference requires a called parameter decorator',
        )
      : { kind: 'skip' };
  }

  const arguments_ = decorator.expression.arguments;

  if (arguments_.length > 0) {
    const firstArgument = arguments_[0];

    if (
      firstArgument !== undefined &&
      isPropertyBoundRequestArgument(firstArgument, checker)
    ) {
      return containsDto
        ? ambiguousRequest(
            options,
            parameter,
            method,
            sourceFile,
            'property-bound request decorators require an explicit scalar schema',
          )
        : { kind: 'skip' };
    }

    if (
      firstArgument !== undefined &&
      hasExplicitParameterSchema(firstArgument)
    ) {
      return { kind: 'skip' };
    }

    return { kind: 'skip' };
  }

  if (
    ts.isUnionTypeNode(declaredType) ||
    ts.isIntersectionTypeNode(declaredType) ||
    ts.isTupleTypeNode(declaredType) ||
    isArrayType(declaredType, checker) ||
    (ts.isTypeReferenceNode(declaredType) &&
      (declaredType.typeArguments?.length ?? 0) > 0)
  ) {
    return containsDto
      ? ambiguousRequest(
          options,
          parameter,
          method,
          sourceFile,
          'request unions, wrappers, tuples, and arrays require one concrete request DTO',
        )
      : { kind: 'skip' };
  }

  const resolvedType = checker.getTypeFromTypeNode(declaredType);
  const requestClassSymbol = getRequestDtoClassSymbol(resolvedType, checker);

  if (requestClassSymbol === undefined) {
    return containsDto
      ? ambiguousRequest(
          options,
          parameter,
          method,
          sourceFile,
          'the request DTO cannot be reduced to one concrete runtime class',
        )
      : { kind: 'skip' };
  }

  if (
    !ts.isTypeReferenceNode(declaredType) ||
    declaredType.typeArguments?.length
  ) {
    return ambiguousRequest(
      options,
      parameter,
      method,
      sourceFile,
      'the request DTO cannot be referenced as a concrete runtime class',
    );
  }

  const expression = createRuntimeReference(
    declaredType.typeName,
    requestClassSymbol,
    controller,
    sourceFile,
    checker,
    importPlanner,
  );

  if (expression === undefined) {
    return ambiguousRequest(
      options,
      parameter,
      method,
      sourceFile,
      'the request DTO is type-only or cannot be referenced safely at runtime',
    );
  }

  return {
    decorator,
    kind: 'infer',
    reference: {
      classSymbol: requestClassSymbol,
      expression,
    },
  };
}

function hasExplicitParameterSchema(expression: ts.Expression): boolean {
  return (
    ts.isObjectLiteralExpression(expression) &&
    expression.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        getPropertyNameText(property.name) === 'schema',
    )
  );
}

function isPropertyBoundRequestArgument(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  if (ts.isStringLiteralLike(expression)) {
    return true;
  }

  const type = checker.getTypeAtLocation(expression);

  return type.isStringLiteral() || (type.flags & ts.TypeFlags.StringLike) !== 0;
}

function ambiguousRequest(
  options: StandardSchemaPluginOptions,
  parameter: ts.ParameterDeclaration,
  method: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
  reason: string,
): RequestAnalysis {
  if (options.onAmbiguous === 'skip') {
    return { kind: 'skip' };
  }

  const position = sourceFile.getLineAndCharacterOfPosition(
    parameter.getStart(),
  );
  const className = ts.isClassDeclaration(method.parent)
    ? (method.parent.name?.text ?? '<anonymous controller>')
    : '<controller>';
  const methodName = method.name.getText(sourceFile);
  const parameterName = parameter.name.getText(sourceFile);

  throw new Error(
    `${PACKAGE_NAME}/plugin: ${className}.${methodName}(${parameterName}): ${reason}. ` +
      `Use a zero-argument @Body(), @Query(), or @Param() with one concrete request DTO, ` +
      `or add native { schema } metadata explicitly. ` +
      `(${sourceFile.fileName}:${position.line + 1}:${position.character + 1})`,
  );
}

function analyzeReturnType(
  declaredType: ts.TypeNode,
  method: ts.MethodDeclaration,
  controller: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  options: StandardSchemaPluginOptions,
  importPlanner: ImportPlanner,
): ReturnAnalysis {
  let current = unwrapResponseType(declaredType);
  let promiseDepth = 0;
  let arrayDepth = 0;

  if (isBuiltInNamedGenericType(current, 'Promise', checker)) {
    const argument = getOnlyTypeArgument(current);

    if (argument === undefined) {
      return ambiguous(
        options,
        method,
        sourceFile,
        'Promise response types must have exactly one type argument',
      );
    }

    promiseDepth = 1;
    current = unwrapResponseType(argument);
  }

  if (isArrayType(current, checker)) {
    const element = getArrayElementType(current);

    if (element === undefined) {
      return ambiguous(
        options,
        method,
        sourceFile,
        'Array response types must have exactly one item type',
      );
    }

    arrayDepth = 1;
    current = unwrapResponseType(element);
  }

  if (
    isBuiltInNamedGenericType(current, 'Promise', checker) ||
    isArrayType(current, checker) ||
    promiseDepth > 1 ||
    arrayDepth > 1
  ) {
    return containsResponseDto(current, checker)
      ? ambiguous(
          options,
          method,
          sourceFile,
          'nested Promise or array response types require an explicit response contract',
        )
      : { kind: 'skip' };
  }

  if (current.kind === ts.SyntaxKind.VoidKeyword) {
    return { kind: 'skip' };
  }

  if (ts.isUnionTypeNode(current)) {
    return containsResponseDto(current, checker)
      ? ambiguous(
          options,
          method,
          sourceFile,
          'union response types require one concrete response DTO',
        )
      : { kind: 'skip' };
  }

  if (ts.isIntersectionTypeNode(current)) {
    return containsResponseDto(current, checker)
      ? ambiguous(
          options,
          method,
          sourceFile,
          'intersection response types require one concrete response DTO',
        )
      : { kind: 'skip' };
  }

  if (ts.isTupleTypeNode(current)) {
    return containsResponseDto(current, checker)
      ? ambiguous(
          options,
          method,
          sourceFile,
          'tuple response types require an explicit response contract',
        )
      : { kind: 'skip' };
  }

  const resolvedType = checker.getTypeFromTypeNode(current);

  if ((resolvedType.flags & ts.TypeFlags.TypeParameter) !== 0) {
    return ambiguous(
      options,
      method,
      sourceFile,
      'unresolved generic response types require an explicit response contract',
    );
  }

  const responseClassSymbol = getResponseDtoClassSymbol(resolvedType, checker);

  if (responseClassSymbol === undefined) {
    if (containsResponseDtoInTypeArguments(current, checker)) {
      return ambiguous(
        options,
        method,
        sourceFile,
        'response envelopes and generic wrappers require one concrete response DTO',
      );
    }

    return { kind: 'skip' };
  }

  if (!ts.isTypeReferenceNode(current) || current.typeArguments?.length) {
    return ambiguous(
      options,
      method,
      sourceFile,
      'the response DTO cannot be referenced as a concrete runtime class',
    );
  }

  const expression = createRuntimeReference(
    current.typeName,
    responseClassSymbol,
    controller,
    sourceFile,
    checker,
    importPlanner,
  );

  if (expression === undefined) {
    return ambiguous(
      options,
      method,
      sourceFile,
      'the response DTO is type-only or cannot be referenced safely at runtime',
    );
  }

  const status = options.swagger
    ? resolveResponseStatus(method, sourceFile, checker, options)
    : undefined;

  if (status === undefined && options.swagger) {
    return { kind: 'skip' };
  }

  if (status === 204) {
    return { kind: 'skip' };
  }

  return {
    isArray: arrayDepth === 1,
    kind: 'infer',
    reference: {
      classSymbol: responseClassSymbol,
      expression,
    },
    status,
  };
}

function ambiguous(
  options: StandardSchemaPluginOptions,
  method: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
  reason: string,
): ReturnAnalysis {
  if (options.onAmbiguous === 'skip') {
    return { kind: 'skip' };
  }

  const position = sourceFile.getLineAndCharacterOfPosition(method.getStart());
  const className = ts.isClassDeclaration(method.parent)
    ? (method.parent.name?.text ?? '<anonymous controller>')
    : '<controller>';
  const methodName = method.name.getText(sourceFile);

  throw new Error(
    `${PACKAGE_NAME}/plugin: ${className}.${methodName}: ${reason}. ` +
      `Add @StandardSchemaResponse(...) explicitly. ` +
      `(${sourceFile.fileName}:${position.line + 1}:${position.character + 1})`,
  );
}

function resolveResponseStatus(
  method: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  options: StandardSchemaPluginOptions,
): number | undefined {
  const httpCodeDecorator = getDecorators(method).find((decorator) =>
    decoratorMatches(
      decorator,
      checker,
      new Set(['HttpCode']),
      NEST_COMMON_PACKAGE,
    ),
  );

  if (httpCodeDecorator === undefined) {
    const defaultStatus = resolveDefaultResponseStatus(method, checker);

    if (defaultStatus !== undefined) {
      return defaultStatus;
    }

    ambiguous(
      options,
      method,
      sourceFile,
      'the HTTP method and default response status cannot be resolved statically',
    );
    return undefined;
  }

  if (!ts.isCallExpression(httpCodeDecorator.expression)) {
    ambiguous(
      options,
      method,
      sourceFile,
      'the response status from @HttpCode cannot be resolved statically',
    );
    return undefined;
  }

  const statusArgument = httpCodeDecorator.expression.arguments[0];
  const status =
    statusArgument === undefined
      ? undefined
      : resolveNumericExpression(statusArgument, checker);

  if (status === undefined) {
    ambiguous(
      options,
      method,
      sourceFile,
      'the response status from @HttpCode cannot be resolved statically',
    );
    return undefined;
  }

  return status;
}

function resolveDefaultResponseStatus(
  method: ts.MethodDeclaration,
  checker: ts.TypeChecker,
): number | undefined {
  for (const decorator of getDecorators(method)) {
    const identity = getDecoratorIdentity(decorator, checker);

    if (
      identity === undefined ||
      identity.moduleSpecifier !== NEST_COMMON_PACKAGE
    ) {
      continue;
    }

    if (identity.name === 'Post') {
      return 201;
    }

    if (identity.name !== 'RequestMapping') {
      continue;
    }

    if (!ts.isCallExpression(decorator.expression)) {
      return undefined;
    }

    const metadata = decorator.expression.arguments[0];

    if (metadata === undefined) {
      return 200;
    }

    if (!ts.isObjectLiteralExpression(metadata)) {
      return undefined;
    }

    const methodProperty = metadata.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        getPropertyNameText(property.name) === 'method',
    );

    if (methodProperty === undefined) {
      return metadata.properties.some(ts.isSpreadAssignment) ? undefined : 200;
    }

    if (!ts.isPropertyAssignment(methodProperty)) {
      return undefined;
    }

    const requestMethod = resolveNumericExpression(
      methodProperty.initializer,
      checker,
    );

    return requestMethod === undefined
      ? undefined
      : requestMethod === 1
        ? 201
        : 200;
  }

  return 200;
}

function resolveNumericExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): number | undefined {
  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text);
  }

  if (
    ts.isPrefixUnaryExpression(expression) &&
    ts.isNumericLiteral(expression.operand)
  ) {
    const value = Number(expression.operand.text);

    return expression.operator === ts.SyntaxKind.MinusToken ? -value : value;
  }

  const type = checker.getTypeAtLocation(expression);

  return type.isNumberLiteral() ? type.value : undefined;
}

function analyzeSwaggerResponseMetadata(
  method: ts.MethodDeclaration,
  analysis: Extract<ReturnAnalysis, { readonly kind: 'infer' }>,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  options: StandardSchemaPluginOptions,
): SwaggerResponseMetadataAnalysis {
  const matches: ts.Decorator[] = [];

  for (const decorator of getDecorators(method)) {
    const status = getSwaggerResponseStatus(decorator, checker);

    if (status.kind === 'unresolved') {
      return ambiguousSwaggerMetadata(
        options,
        method,
        sourceFile,
        'an @ApiResponse status cannot be resolved statically',
      );
    }

    if (status.kind === 'known' && status.value === (analysis.status ?? 200)) {
      matches.push(decorator);
    }
  }

  if (matches.length > 1) {
    return ambiguousSwaggerMetadata(
      options,
      method,
      sourceFile,
      'multiple Swagger decorators describe the inferred success status',
    );
  }

  const target = matches[0];

  if (target === undefined) {
    return {
      hasExplicitContract: false,
      kind: 'infer',
      target: undefined,
    };
  }

  if (!ts.isCallExpression(target.expression)) {
    return ambiguousSwaggerMetadata(
      options,
      method,
      sourceFile,
      'the existing Swagger success decorator cannot be enriched safely',
    );
  }

  const optionsExpression = target.expression.arguments[0];

  if (optionsExpression === undefined) {
    return {
      hasExplicitContract: false,
      kind: 'infer',
      target,
    };
  }

  if (!ts.isObjectLiteralExpression(optionsExpression)) {
    return ambiguousSwaggerMetadata(
      options,
      method,
      sourceFile,
      'the existing Swagger success options are not statically inspectable',
    );
  }

  if (
    optionsExpression.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) ||
        getObjectLiteralPropertyName(property) === undefined,
    )
  ) {
    return ambiguousSwaggerMetadata(
      options,
      method,
      sourceFile,
      'the existing Swagger success options contain dynamic properties',
    );
  }

  return {
    hasExplicitContract: optionsExpression.properties.some((property) =>
      EXPLICIT_SWAGGER_CONTRACT_PROPERTIES.has(
        getObjectLiteralPropertyName(property) ?? '',
      ),
    ),
    kind: 'infer',
    target,
  };
}

function getSwaggerResponseStatus(
  decorator: ts.Decorator,
  checker: ts.TypeChecker,
):
  | { readonly kind: 'known'; readonly value: number }
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'unrelated' } {
  const identity = getDecoratorIdentity(decorator, checker);

  if (
    identity === undefined ||
    identity.moduleSpecifier !== NEST_SWAGGER_PACKAGE
  ) {
    return { kind: 'unrelated' };
  }

  const knownStatus = SWAGGER_RESPONSE_STATUS.get(identity.name);

  if (knownStatus !== undefined) {
    return {
      kind: 'known',
      value: knownStatus,
    };
  }

  if (identity.name !== 'ApiResponse') {
    return { kind: 'unrelated' };
  }

  if (!ts.isCallExpression(decorator.expression)) {
    return { kind: 'unresolved' };
  }

  const optionsExpression = decorator.expression.arguments[0];

  if (
    optionsExpression === undefined ||
    !ts.isObjectLiteralExpression(optionsExpression)
  ) {
    return { kind: 'unresolved' };
  }

  const statusProperty = optionsExpression.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      getPropertyNameText(property.name) === 'status',
  );

  if (
    statusProperty === undefined ||
    !ts.isPropertyAssignment(statusProperty)
  ) {
    return { kind: 'unrelated' };
  }

  const status = resolveNumericExpression(statusProperty.initializer, checker);

  if (status !== undefined) {
    return {
      kind: 'known',
      value: status,
    };
  }

  return resolveStringExpression(statusProperty.initializer, checker) ===
    undefined
    ? { kind: 'unresolved' }
    : { kind: 'unrelated' };
}

function resolveStringExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): string | undefined {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }

  const type = checker.getTypeAtLocation(expression);

  return type.isStringLiteral() ? type.value : undefined;
}

function getObjectLiteralPropertyName(
  property: ts.ObjectLiteralElementLike,
): string | undefined {
  if (ts.isSpreadAssignment(property)) {
    return undefined;
  }

  return property.name === undefined
    ? undefined
    : getPropertyNameText(property.name);
}

function ambiguousSwaggerMetadata(
  options: StandardSchemaPluginOptions,
  method: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
  reason: string,
): SwaggerResponseMetadataAnalysis {
  if (options.onAmbiguous === 'skip') {
    return { kind: 'skip' };
  }

  const position = sourceFile.getLineAndCharacterOfPosition(method.getStart());
  const className = ts.isClassDeclaration(method.parent)
    ? (method.parent.name?.text ?? '<anonymous controller>')
    : '<controller>';
  const methodName = method.name.getText(sourceFile);

  throw new Error(
    `${PACKAGE_NAME}/plugin: ${className}.${methodName}: ${reason}. ` +
      `Use @ApiStandardSchemaResponse(...) or explicit static Swagger response metadata. ` +
      `(${sourceFile.fileName}:${position.line + 1}:${position.character + 1})`,
  );
}

function createRuntimeReference(
  typeName: ts.EntityName,
  responseClassSymbol: ts.Symbol,
  controller: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  importPlanner: ImportPlanner,
): ts.Expression | undefined {
  if (!responseClassHasRuntimeDeclaration(responseClassSymbol, checker)) {
    return undefined;
  }

  const referencedSymbol = checker.getSymbolAtLocation(
    ts.isIdentifier(typeName) ? typeName : typeName.right,
  );

  if (
    referencedSymbol === undefined ||
    resolveAlias(referencedSymbol, checker) !== responseClassSymbol
  ) {
    return undefined;
  }

  if (ts.isIdentifier(typeName)) {
    const importBinding = getImportBinding(referencedSymbol);

    if (importBinding !== undefined) {
      if (
        !canUseImportBindingAsValue(importBinding, responseClassSymbol, checker)
      ) {
        return undefined;
      }

      importPlanner.markAsValue(importBinding);
      return ts.factory.createIdentifier(typeName.text);
    }

    const declaration = responseClassSymbol.valueDeclaration;

    if (
      declaration === undefined ||
      declaration.getSourceFile() !== sourceFile ||
      declaration.getStart(sourceFile) > controller.getStart(sourceFile)
    ) {
      return undefined;
    }

    return ts.factory.createIdentifier(typeName.text);
  }

  const leftmostIdentifier = getLeftmostIdentifier(typeName);
  const namespaceSymbol = checker.getSymbolAtLocation(leftmostIdentifier);
  const namespaceBinding =
    namespaceSymbol === undefined
      ? undefined
      : getImportBinding(namespaceSymbol);

  if (
    namespaceBinding === undefined ||
    !ts.isNamespaceImport(namespaceBinding) ||
    !canUseImportBindingAsValue(
      namespaceBinding,
      responseClassSymbol,
      checker,
      typeName.right.text,
    )
  ) {
    return undefined;
  }

  importPlanner.markAsValue(namespaceBinding);

  return entityNameToExpression(typeName);
}

function responseClassHasRuntimeDeclaration(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  const declaration = resolveAlias(symbol, checker).declarations?.find(
    ts.isClassDeclaration,
  );

  return (
    declaration !== undefined &&
    (declaration.getSourceFile().isDeclarationFile ||
      !hasModifier(declaration, ts.SyntaxKind.DeclareKeyword))
  );
}

function getResponseDtoClassSymbol(
  type: ts.Type,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  return getDtoClassSymbol(type, checker, 'STANDARD_SCHEMA_RESPONSE_DTO');
}

function getRequestDtoClassSymbol(
  type: ts.Type,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  return getDtoClassSymbol(type, checker, 'STANDARD_SCHEMA_DTO');
}

function getDtoClassSymbol(
  type: ts.Type,
  checker: ts.TypeChecker,
  brandName: 'STANDARD_SCHEMA_DTO' | 'STANDARD_SCHEMA_RESPONSE_DTO',
): ts.Symbol | undefined {
  const symbol = type.getSymbol();

  if (symbol === undefined) {
    return undefined;
  }

  const resolvedSymbol = resolveAlias(symbol, checker);
  const declaration = resolvedSymbol.declarations?.find(ts.isClassDeclaration);

  if (declaration === undefined) {
    return undefined;
  }

  const staticType = checker.getTypeOfSymbolAtLocation(
    resolvedSymbol,
    declaration,
  );
  const dtoBrand = staticType.getProperties().find((property) => {
    return property.declarations?.some((propertyDeclaration) => {
      const propertyName = (propertyDeclaration as ts.NamedDeclaration).name;

      if (
        propertyName === undefined ||
        !ts.isComputedPropertyName(propertyName)
      ) {
        return false;
      }

      const brandSymbol = checker.getSymbolAtLocation(propertyName.expression);

      return (
        brandSymbol !== undefined &&
        resolveAlias(brandSymbol, checker).getName() === brandName &&
        isSymbolDeclaredByPackage(
          resolveAlias(brandSymbol, checker),
          PACKAGE_NAME,
        )
      );
    });
  });

  if (dtoBrand === undefined) {
    return undefined;
  }

  const brandDeclaration =
    dtoBrand.valueDeclaration ?? dtoBrand.declarations?.[0];

  if (
    brandDeclaration === undefined ||
    checker.typeToString(
      checker.getTypeOfSymbolAtLocation(dtoBrand, brandDeclaration),
    ) !== 'true'
  ) {
    return undefined;
  }

  return resolvedSymbol;
}

function containsRequestDto(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
): boolean {
  return containsDto(typeNode, checker, getRequestDtoClassSymbol);
}

function containsResponseDto(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
): boolean {
  return containsDto(typeNode, checker, getResponseDtoClassSymbol);
}

function containsDto(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
  getClassSymbol: (
    type: ts.Type,
    checker: ts.TypeChecker,
  ) => ts.Symbol | undefined,
): boolean {
  const unwrapped = unwrapResponseType(typeNode);
  const type = checker.getTypeFromTypeNode(unwrapped);

  if (getClassSymbol(type, checker) !== undefined) {
    return true;
  }

  if (ts.isUnionTypeNode(unwrapped) || ts.isIntersectionTypeNode(unwrapped)) {
    return unwrapped.types.some((member) =>
      containsDto(member, checker, getClassSymbol),
    );
  }

  if (ts.isArrayTypeNode(unwrapped)) {
    return containsDto(unwrapped.elementType, checker, getClassSymbol);
  }

  if (ts.isTupleTypeNode(unwrapped)) {
    return unwrapped.elements.some((element) =>
      containsDto(element, checker, getClassSymbol),
    );
  }

  return (
    ts.isTypeReferenceNode(unwrapped) &&
    (unwrapped.typeArguments?.some((argument) =>
      containsDto(argument, checker, getClassSymbol),
    ) ??
      false)
  );
}

function containsResponseDtoInTypeArguments(
  typeNode: ts.TypeNode,
  checker: ts.TypeChecker,
): boolean {
  return (
    ts.isTypeReferenceNode(typeNode) &&
    (typeNode.typeArguments?.some((argument) =>
      containsResponseDto(argument, checker),
    ) ??
      false)
  );
}

function hasRawResponseParameter(
  method: ts.MethodDeclaration,
  checker: ts.TypeChecker,
): boolean {
  return method.parameters.some((parameter) => {
    return getDecorators(parameter).some((decorator) => {
      return (
        decoratorMatches(
          decorator,
          checker,
          RAW_RESPONSE_DECORATORS,
          NEST_COMMON_PACKAGE,
        ) && !isLiteralPassthroughResponse(decorator)
      );
    });
  });
}

function isLiteralPassthroughResponse(decorator: ts.Decorator): boolean {
  if (!ts.isCallExpression(decorator.expression)) {
    return false;
  }

  const options = decorator.expression.arguments[0];

  if (options === undefined || !ts.isObjectLiteralExpression(options)) {
    return false;
  }

  return options.properties.some((property) => {
    return (
      ts.isPropertyAssignment(property) &&
      getPropertyNameText(property.name) === 'passthrough' &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword
    );
  });
}

function isNoContentRoute(
  method: ts.MethodDeclaration,
  checker: ts.TypeChecker,
): boolean {
  const decorator = getDecorators(method).find((candidate) =>
    decoratorMatches(
      candidate,
      checker,
      new Set(['HttpCode']),
      NEST_COMMON_PACKAGE,
    ),
  );

  if (decorator === undefined || !ts.isCallExpression(decorator.expression)) {
    return false;
  }

  const statusArgument = decorator.expression.arguments[0];

  if (statusArgument === undefined) {
    return false;
  }

  if (ts.isNumericLiteral(statusArgument)) {
    return Number(statusArgument.text) === 204;
  }

  const statusType = checker.getTypeAtLocation(statusArgument);

  return statusType.isNumberLiteral() && statusType.value === 204;
}

/**
 * `resolveResponseStatus` for the rewrite path, which must never fail a build.
 *
 * Inference may throw on an unresolvable status because inference is the plugin VOLUNTEERING
 * metadata — the author can silence it by declaring one. The rewrite acts on code the author
 * already wrote and that compiles today, and `preflightProgram` never visits these methods (it
 * `continue`s on `hasExplicitResponseDecorator`), so a throw here escapes mid-transform,
 * un-aggregated, carrying a remediation message that tells the author to add the very decorator
 * the method already has. Forcing `skip` turns "cannot tell" into "leave it alone".
 */
function resolveRewriteResponseStatus(
  method: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  options: StandardSchemaPluginOptions,
): number | undefined {
  return resolveResponseStatus(method, sourceFile, checker, {
    ...options,
    onAmbiguous: 'skip',
  });
}

/**
 * Nest discards `@HttpCode` on a redirect route — `RouterResponseController.redirect` uses
 * `result?.statusCode ?? redirectResponse.statusCode ?? HttpStatus.FOUND` — so neither the
 * decorator nor the verb predicts the status. Any number we derived would be fiction.
 */
function isRedirectRoute(
  method: ts.MethodDeclaration,
  checker: ts.TypeChecker,
): boolean {
  return hasDecorator(
    method,
    checker,
    new Set(['Redirect']),
    NEST_COMMON_PACKAGE,
  );
}

/**
 * True when any `@nestjs/swagger` response decorator is already on the method.
 *
 * Landing on a real status means sharing a response key with such a decorator, and the merge is
 * destructive in a way source order cannot fix: `ApiResponse` merges incoming over existing, then
 * `ResponseObjectFactory` short-circuits on `standardSchema` and omits `type`, so a hand-written
 * `@ApiOkResponse({ type: LegacyDto })` loses `LegacyDto` with no diagnostic. Backing off is the
 * only correct answer — and it is what the inference path already does through
 * `hasExplicitContract`.
 *
 * This is deliberately coarser than the inference path's check: it backs off for ANY swagger
 * response decorator, including a description-only one that would have merged harmlessly. Coarse
 * costs a schema that could have been documented; precise costs a refactor of
 * `analyzeSwaggerResponseMetadata`, whose five error strings and their ordering are pinned by
 * tests. Cheap and safe beats clever here.
 */
function hasSwaggerResponseDecorator(
  method: ts.MethodDeclaration,
  checker: ts.TypeChecker,
): boolean {
  const names = new Set(['ApiResponse', ...SWAGGER_RESPONSE_STATUS.keys()]);
  return hasDecorator(method, checker, names, NEST_SWAGGER_PACKAGE);
}

function hasDecorator(
  node: ts.Node,
  checker: ts.TypeChecker,
  names: ReadonlySet<string>,
  moduleSpecifier?: string,
): boolean {
  return getDecorators(node).some((decorator) =>
    decoratorMatches(decorator, checker, names, moduleSpecifier),
  );
}

function hasExplicitResponseDecorator(
  node: ts.Node,
  checker: ts.TypeChecker,
): boolean {
  return getDecorators(node).some((decorator) => {
    return (
      decoratorMatches(
        decorator,
        checker,
        NEST_RESPONSE_DECORATORS,
        NEST_COMMON_PACKAGE,
      ) ||
      decoratorMatches(
        decorator,
        checker,
        PACKAGE_RESPONSE_DECORATORS,
        PACKAGE_NAME,
      ) ||
      decoratorMatches(
        decorator,
        checker,
        PACKAGE_SWAGGER_RESPONSE_DECORATORS,
        PACKAGE_SWAGGER_SUBPATH,
      ) ||
      isSyntheticStandardSchemaResponseDecorator(decorator)
    );
  });
}

/**
 * The method's own `@StandardSchemaResponse(source)`, when it can be upgraded to the documented
 * form.
 *
 * `ApiStandardSchemaResponse(source)` applies `StandardSchemaResponse(source, {})` and adds
 * `ApiResponse` — a strict superset, and byte-identical serialization for a single-argument
 * call. That equivalence is why only single-argument calls qualify: with a second argument the
 * two decorators partition the options differently (`validateOptions` goes to serialization, the
 * rest to Swagger), so rewriting could silently move a `SerializeOptions` key into the document.
 * Those keep their current behaviour and the author can opt in by hand.
 */
function findUpgradableResponseDecorator(
  method: ts.MethodDeclaration,
  checker: ts.TypeChecker,
):
  | { readonly decorator: ts.Decorator; readonly source: ts.Expression }
  | undefined {
  for (const decorator of getDecorators(method)) {
    if (
      !decoratorMatches(
        decorator,
        checker,
        PACKAGE_RESPONSE_DECORATORS,
        PACKAGE_NAME,
      ) ||
      !ts.isCallExpression(decorator.expression) ||
      decorator.expression.arguments.length !== 1
    ) {
      continue;
    }
    const [source] = decorator.expression.arguments;
    if (source !== undefined) return { decorator, source };
  }
  return undefined;
}

function isSyntheticStandardSchemaResponseDecorator(
  decorator: ts.Decorator,
): boolean {
  if (
    decorator.pos >= 0 ||
    !ts.isCallExpression(decorator.expression) ||
    !ts.isPropertyAccessExpression(decorator.expression.expression)
  ) {
    return false;
  }

  const expression = decorator.expression.expression;

  return (
    ts.isIdentifier(expression.expression) &&
    expression.expression.text.startsWith('_nestmStandardSchema') &&
    (expression.name.text === 'ApiStandardSchemaResponse' ||
      expression.name.text === 'StandardSchemaResponse')
  );
}

function decoratorMatches(
  decorator: ts.Decorator,
  checker: ts.TypeChecker,
  names: ReadonlySet<string>,
  moduleSpecifier?: string,
): boolean {
  const identity = getDecoratorIdentity(decorator, checker);

  if (identity === undefined) {
    const syntacticName = getDecoratorSyntacticName(decorator);

    return moduleSpecifier === undefined && names.has(syntacticName ?? '');
  }

  return (
    names.has(identity.name) &&
    (moduleSpecifier === undefined ||
      identity.moduleSpecifier === moduleSpecifier)
  );
}

function getDecoratorSyntacticName(
  decorator: ts.Decorator,
): string | undefined {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  return ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : undefined;
}

function getDecoratorIdentity(
  decorator: ts.Decorator,
  checker: ts.TypeChecker,
): DecoratorIdentity | undefined {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;

  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);

    if (symbol === undefined) {
      return undefined;
    }

    const resolved = resolveAlias(symbol, checker);
    const declarationPackage = getDeclarationPackage(resolved);

    if (declarationPackage !== undefined) {
      return {
        moduleSpecifier: declarationPackage,
        name: resolved.getName(),
      };
    }

    const binding = getImportBinding(symbol);
    const imported = binding && getImportedNameAndModule(binding);

    if (imported !== undefined) {
      return imported;
    }

    return {
      moduleSpecifier: undefined,
      name: resolved.getName(),
    };
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const symbol = checker.getSymbolAtLocation(expression.name);

    if (symbol !== undefined) {
      const resolved = resolveAlias(symbol, checker);
      const declarationPackage = getDeclarationPackage(resolved);

      if (declarationPackage !== undefined) {
        return {
          moduleSpecifier: declarationPackage,
          name: resolved.getName(),
        };
      }
    }

    const leftmost = getLeftmostExpressionIdentifier(expression);
    const namespaceSymbol = checker.getSymbolAtLocation(leftmost);
    const binding =
      namespaceSymbol === undefined
        ? undefined
        : getImportBinding(namespaceSymbol);

    if (binding !== undefined && ts.isNamespaceImport(binding)) {
      return {
        moduleSpecifier: getImportModuleSpecifier(binding),
        name: expression.name.text,
      };
    }

    if (symbol !== undefined) {
      const resolved = resolveAlias(symbol, checker);

      return {
        moduleSpecifier: getDeclarationPackage(resolved),
        name: resolved.getName(),
      };
    }
  }

  return undefined;
}

function getDeclarationPackage(symbol: ts.Symbol): string | undefined {
  const fileName = symbol.declarations?.[0]
    ?.getSourceFile()
    .fileName.replaceAll('\\', '/');

  if (fileName === undefined) {
    return undefined;
  }

  if (fileName.includes('/node_modules/@nestjs/common/')) {
    return NEST_COMMON_PACKAGE;
  }

  if (fileName.includes('/node_modules/@nestjs/swagger/')) {
    return NEST_SWAGGER_PACKAGE;
  }

  if (getNearestPackageName(fileName) === PACKAGE_NAME) {
    if (
      /\/(?:dist|src)\/swagger\/api-standard-schema-response\.decorator\.(?:d\.)?[cm]?ts$/.test(
        fileName,
      )
    ) {
      return PACKAGE_SWAGGER_SUBPATH;
    }

    if (
      /\/(?:dist|src)\/standard-schema-response\.decorator\.(?:d\.)?[cm]?ts$/.test(
        fileName,
      )
    ) {
      return PACKAGE_NAME;
    }
  }

  return undefined;
}

function getPropertyNameText(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }

  return undefined;
}

function isSymbolDeclaredByPackage(
  symbol: ts.Symbol,
  expectedPackageName: string,
): boolean {
  return (
    symbol.declarations?.some((declaration) => {
      const fileName = declaration
        .getSourceFile()
        .fileName.replaceAll('\\', '/');

      return (
        getNearestPackageName(fileName) === expectedPackageName &&
        /\/(?:dist|src)\/schema\.(?:d\.)?[cm]?ts$/.test(fileName)
      );
    }) ?? false
  );
}

function getNearestPackageName(fileName: string): string | undefined {
  let currentDirectory = path.dirname(fileName);
  const visitedDirectories: string[] = [];
  let packageName: string | undefined;

  while (true) {
    if (packageNameByDirectory.has(currentDirectory)) {
      packageName = packageNameByDirectory.get(currentDirectory);
      break;
    }

    visitedDirectories.push(currentDirectory);

    const packagePath = path.join(currentDirectory, 'package.json');

    if (fs.existsSync(packagePath)) {
      try {
        const manifest: unknown = JSON.parse(
          fs.readFileSync(packagePath, 'utf8'),
        );

        packageName =
          isRecord(manifest) && typeof manifest['name'] === 'string'
            ? manifest['name']
            : undefined;
      } catch {
        packageName = undefined;
      }

      break;
    }

    const parentDirectory = path.dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      break;
    }

    currentDirectory = parentDirectory;
  }

  for (const visitedDirectory of visitedDirectories) {
    packageNameByDirectory.set(visitedDirectory, packageName);
  }

  return packageName;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function getImportedNameAndModule(
  binding: ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport,
): DecoratorIdentity | undefined {
  if (ts.isImportSpecifier(binding)) {
    return {
      moduleSpecifier: getImportModuleSpecifier(binding),
      name: (binding.propertyName ?? binding.name).text,
    };
  }

  if (ts.isImportClause(binding) && binding.name !== undefined) {
    return {
      moduleSpecifier: getImportModuleSpecifier(binding),
      name: 'default',
    };
  }

  return undefined;
}

function getImportBinding(
  symbol: ts.Symbol,
): ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport | undefined {
  return symbol.declarations?.find(
    (
      declaration,
    ): declaration is
      ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport =>
      ts.isImportClause(declaration) ||
      ts.isImportSpecifier(declaration) ||
      ts.isNamespaceImport(declaration),
  );
}

function getImportModuleSpecifier(
  binding: ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport,
): string | undefined {
  const declaration = getImportDeclaration(binding);

  return declaration !== undefined &&
    ts.isStringLiteral(declaration.moduleSpecifier)
    ? declaration.moduleSpecifier.text
    : undefined;
}

function canUseImportBindingAsValue(
  binding: ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport,
  expectedSymbol: ts.Symbol,
  checker: ts.TypeChecker,
  namespaceMember?: string,
): boolean {
  const importDeclaration = getImportDeclaration(binding);

  if (importDeclaration === undefined) {
    return false;
  }

  const moduleSymbol = checker.getSymbolAtLocation(
    importDeclaration.moduleSpecifier,
  );

  if (moduleSymbol === undefined) {
    return false;
  }

  const exportName = ts.isImportSpecifier(binding)
    ? (binding.propertyName ?? binding.name).text
    : ts.isImportClause(binding)
      ? 'default'
      : namespaceMember;

  if (exportName === undefined) {
    return true;
  }

  return moduleExportsExpectedRuntimeValue(
    resolveAlias(moduleSymbol, checker),
    exportName,
    expectedSymbol,
    checker,
    new Set(),
  );
}

function moduleExportsExpectedRuntimeValue(
  moduleSymbol: ts.Symbol,
  exportName: string,
  expectedSymbol: ts.Symbol,
  checker: ts.TypeChecker,
  visited: Set<string>,
): boolean {
  const sourceFile = moduleSymbol.declarations?.find(ts.isSourceFile);

  if (sourceFile === undefined) {
    return false;
  }

  const visitKey = `${sourceFile.fileName}\0${exportName}`;

  if (visited.has(visitKey)) {
    return false;
  }

  visited.add(visitKey);

  for (const statement of sourceFile.statements) {
    if (
      ts.isClassDeclaration(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      if (
        (exportName === 'default' &&
          hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) ||
        (exportName !== 'default' && statement.name?.text === exportName)
      ) {
        return (
          (!hasModifier(statement, ts.SyntaxKind.DeclareKeyword) ||
            sourceFile.isDeclarationFile) &&
          symbolHasDeclaration(expectedSymbol, statement, checker)
        );
      }
    }

    if (ts.isExportAssignment(statement) && exportName === 'default') {
      const assignmentSymbol = checker.getSymbolAtLocation(
        statement.expression,
      );

      return (
        assignmentSymbol !== undefined &&
        symbolsRepresentSameValue(assignmentSymbol, expectedSymbol, checker)
      );
    }

    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) {
      continue;
    }

    const targetModule =
      statement.moduleSpecifier === undefined
        ? undefined
        : checker.getSymbolAtLocation(statement.moduleSpecifier);

    if (statement.exportClause === undefined) {
      if (
        targetModule !== undefined &&
        moduleExportsExpectedRuntimeValue(
          resolveAlias(targetModule, checker),
          exportName,
          expectedSymbol,
          checker,
          visited,
        )
      ) {
        return true;
      }

      continue;
    }

    if (ts.isNamespaceExport(statement.exportClause)) {
      continue;
    }

    for (const specifier of statement.exportClause.elements) {
      if (specifier.isTypeOnly || specifier.name.text !== exportName) {
        continue;
      }

      const localName = (specifier.propertyName ?? specifier.name).text;

      if (targetModule !== undefined) {
        if (
          moduleExportsExpectedRuntimeValue(
            resolveAlias(targetModule, checker),
            localName,
            expectedSymbol,
            checker,
            visited,
          )
        ) {
          return true;
        }

        continue;
      }

      if (
        localModuleExportsExpectedRuntimeValue(
          sourceFile,
          localName,
          expectedSymbol,
          checker,
          visited,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function localModuleExportsExpectedRuntimeValue(
  sourceFile: ts.SourceFile,
  localName: string,
  expectedSymbol: ts.Symbol,
  checker: ts.TypeChecker,
  visited: Set<string>,
): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    const importClause = statement.importClause;

    if (
      importClause === undefined ||
      importClause.isTypeOnly ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    let importedName: string | undefined;

    if (importClause.name?.text === localName) {
      importedName = 'default';
    } else if (
      importClause.namedBindings !== undefined &&
      ts.isNamedImports(importClause.namedBindings)
    ) {
      const importSpecifier = importClause.namedBindings.elements.find(
        (candidate) => candidate.name.text === localName,
      );

      if (importSpecifier !== undefined && !importSpecifier.isTypeOnly) {
        importedName = (importSpecifier.propertyName ?? importSpecifier.name)
          .text;
      }
    }

    if (importedName === undefined) {
      continue;
    }

    const targetModule = checker.getSymbolAtLocation(statement.moduleSpecifier);

    return (
      targetModule !== undefined &&
      moduleExportsExpectedRuntimeValue(
        resolveAlias(targetModule, checker),
        importedName,
        expectedSymbol,
        checker,
        visited,
      )
    );
  }

  const localClass = sourceFile.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === localName,
  );

  if (localClass?.name !== undefined) {
    const localClassSymbol = checker.getSymbolAtLocation(localClass.name);

    return (
      (sourceFile.isDeclarationFile ||
        !hasModifier(localClass, ts.SyntaxKind.DeclareKeyword)) &&
      localClassSymbol !== undefined &&
      symbolsRepresentSameValue(localClassSymbol, expectedSymbol, checker)
    );
  }

  return false;
}

function symbolsRepresentSameValue(
  left: ts.Symbol,
  right: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  const resolvedLeft = resolveAlias(left, checker);
  const resolvedRight = resolveAlias(right, checker);

  return (
    resolvedLeft === resolvedRight ||
    (resolvedLeft.valueDeclaration !== undefined &&
      resolvedLeft.valueDeclaration === resolvedRight.valueDeclaration)
  );
}

function symbolHasDeclaration(
  symbol: ts.Symbol,
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
): boolean {
  return (
    resolveAlias(symbol, checker).declarations?.some(
      (candidate) => candidate === declaration,
    ) ?? false
  );
}

function getImportDeclaration(
  binding: ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport,
): ts.ImportDeclaration | undefined {
  let current: ts.Node | undefined = binding;

  while (current !== undefined && !ts.isImportDeclaration(current)) {
    current = current.parent;
  }

  return current !== undefined && ts.isImportDeclaration(current)
    ? current
    : undefined;
}

function resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  let current = symbol;
  const visited = new Set<ts.Symbol>();

  while (
    (current.flags & ts.SymbolFlags.Alias) !== 0 &&
    !visited.has(current)
  ) {
    visited.add(current);

    const resolved = checker.getAliasedSymbol(current);

    if (resolved === current) {
      break;
    }

    current = resolved;
  }

  return current;
}

function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ??
        false)
    : false;
}

function unwrapResponseType(typeNode: ts.TypeNode): ts.TypeNode {
  let current = typeNode;

  while (
    ts.isParenthesizedTypeNode(current) ||
    (ts.isTypeOperatorNode(current) &&
      current.operator === ts.SyntaxKind.ReadonlyKeyword)
  ) {
    current = current.type;
  }

  return current;
}

function isBuiltInNamedGenericType(
  typeNode: ts.TypeNode,
  name: string,
  checker: ts.TypeChecker,
): typeNode is ts.TypeReferenceNode {
  if (
    !ts.isTypeReferenceNode(typeNode) ||
    !ts.isIdentifier(typeNode.typeName) ||
    typeNode.typeName.text !== name
  ) {
    return false;
  }

  const symbol = checker.getSymbolAtLocation(typeNode.typeName);

  return (
    symbol !== undefined &&
    resolveAlias(symbol, checker).declarations?.some((declaration) =>
      isTypeScriptDefaultLibrary(declaration.getSourceFile()),
    ) === true
  );
}

function isTypeScriptDefaultLibrary(sourceFile: ts.SourceFile): boolean {
  return (
    sourceFile.isDeclarationFile &&
    /^lib\..*\.d\.[cm]?ts$/.test(path.basename(sourceFile.fileName))
  );
}

function getOnlyTypeArgument(
  typeNode: ts.TypeReferenceNode,
): ts.TypeNode | undefined {
  return typeNode.typeArguments?.length === 1
    ? typeNode.typeArguments[0]
    : undefined;
}

function isArrayType(typeNode: ts.TypeNode, checker: ts.TypeChecker): boolean {
  return (
    ts.isArrayTypeNode(typeNode) ||
    isBuiltInNamedGenericType(typeNode, 'Array', checker)
  );
}

function getArrayElementType(typeNode: ts.TypeNode): ts.TypeNode | undefined {
  return ts.isArrayTypeNode(typeNode)
    ? typeNode.elementType
    : ts.isTypeReferenceNode(typeNode)
      ? getOnlyTypeArgument(typeNode)
      : undefined;
}

function getLeftmostIdentifier(entityName: ts.EntityName): ts.Identifier {
  let current = entityName;

  while (ts.isQualifiedName(current)) {
    current = current.left;
  }

  return current;
}

function entityNameToExpression(entityName: ts.EntityName): ts.Expression {
  if (ts.isIdentifier(entityName)) {
    return ts.factory.createIdentifier(entityName.text);
  }

  return ts.factory.createPropertyAccessExpression(
    entityNameToExpression(entityName.left),
    entityName.right.text,
  );
}

function getLeftmostExpressionIdentifier(
  expression: ts.PropertyAccessExpression,
): ts.Identifier {
  let current: ts.Expression = expression;

  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }

  return ts.isIdentifier(current)
    ? current
    : ts.factory.createIdentifier('__unresolved');
}

function findAvailableIdentifier(
  sourceFile: ts.SourceFile,
  preferred: string,
): string {
  const identifiers = new Set<string>();

  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      identifiers.add(node.text);
    }

    ts.forEachChild(node, collect);
  };

  collect(sourceFile);

  if (!identifiers.has(preferred)) {
    return preferred;
  }

  let suffix = 2;

  while (identifiers.has(`${preferred}${suffix}`)) {
    suffix += 1;
  }

  return `${preferred}${suffix}`;
}

class ImportPlanner {
  private readonly valueBindings = new Set<
    ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport
  >();

  constructor(private readonly factory: ts.NodeFactory) {}

  markAsValue(
    binding: ts.ImportClause | ts.ImportSpecifier | ts.NamespaceImport,
  ): void {
    this.valueBindings.add(binding);
  }

  apply(statements: readonly ts.Statement[]): ts.Statement[] {
    return statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement)) {
        return [statement];
      }

      return this.updateImport(statement);
    });
  }

  private updateImport(
    declaration: ts.ImportDeclaration,
  ): ts.ImportDeclaration[] {
    const importClause = declaration.importClause;

    if (importClause === undefined) {
      return [declaration];
    }

    const promoteDefault =
      importClause.name !== undefined && this.valueBindings.has(importClause);
    const namespaceImport =
      importClause.namedBindings !== undefined &&
      ts.isNamespaceImport(importClause.namedBindings)
        ? importClause.namedBindings
        : undefined;
    const promoteNamespace =
      namespaceImport !== undefined && this.valueBindings.has(namespaceImport);
    const namedImports =
      importClause.namedBindings !== undefined &&
      ts.isNamedImports(importClause.namedBindings)
        ? importClause.namedBindings
        : undefined;
    const promotedSpecifiers =
      namedImports?.elements.filter((specifier) =>
        this.valueBindings.has(specifier),
      ) ?? [];

    if (
      !promoteDefault &&
      !promoteNamespace &&
      promotedSpecifiers.length === 0
    ) {
      return [declaration];
    }

    if (namespaceImport !== undefined) {
      return [
        this.factory.updateImportDeclaration(
          declaration,
          declaration.modifiers,
          this.factory.updateImportClause(
            importClause,
            false,
            importClause.name,
            namespaceImport,
          ),
          declaration.moduleSpecifier,
          this.toRuntimeImportAttributes(declaration.attributes),
        ),
      ];
    }

    const runtimeSpecifiers =
      namedImports?.elements.flatMap((specifier) => {
        if (this.valueBindings.has(specifier)) {
          return [
            this.factory.updateImportSpecifier(
              specifier,
              false,
              specifier.propertyName,
              specifier.name,
            ),
          ];
        }

        return importClause.isTypeOnly || specifier.isTypeOnly
          ? []
          : [specifier];
      }) ?? [];
    const runtimeDefault =
      importClause.name !== undefined &&
      (!importClause.isTypeOnly || promoteDefault)
        ? importClause.name
        : undefined;
    const runtimeNamedImports =
      namedImports === undefined || runtimeSpecifiers.length === 0
        ? undefined
        : this.factory.updateNamedImports(namedImports, runtimeSpecifiers);

    return [
      this.factory.updateImportDeclaration(
        declaration,
        declaration.modifiers,
        this.factory.updateImportClause(
          importClause,
          false,
          runtimeDefault,
          runtimeNamedImports,
        ),
        declaration.moduleSpecifier,
        this.toRuntimeImportAttributes(declaration.attributes),
      ),
    ];
  }

  private toRuntimeImportAttributes(
    attributes: ts.ImportAttributes | undefined,
  ): ts.ImportAttributes | undefined {
    if (attributes === undefined) {
      return undefined;
    }

    const runtimeElements = attributes.elements.filter(
      (attribute) => getPropertyNameText(attribute.name) !== 'resolution-mode',
    );

    if (runtimeElements.length === 0) {
      return undefined;
    }

    return runtimeElements.length === attributes.elements.length
      ? attributes
      : this.factory.updateImportAttributes(
          attributes,
          this.factory.createNodeArray(runtimeElements),
          attributes.multiLine,
        );
  }
}

const plugin = { before };

// Keep the named property statically visible to Node's CJS lexer as well as
// assigning the complete plugin object for Nest's synchronous `require()`.
exports.before = before;
export = plugin;
