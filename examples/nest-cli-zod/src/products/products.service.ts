import { Injectable, NotFoundException } from '@nestjs/common';

import type { CreateProductDto, ListProductsQueryDto } from './product.dto.js';

export interface ProductRecord {
  readonly id: number;
  readonly name: string;
  readonly price: number;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly internalRevision: number;
}

export interface ProductSummaryRecord {
  readonly count: number;
  readonly internalRevision: number;
}

@Injectable()
export class ProductsService {
  private readonly products = new Map<number, ProductRecord>();
  private nextId = 1;
  private revision = 0;

  create(input: CreateProductDto): ProductRecord {
    const now = new Date();
    const product: ProductRecord = {
      id: this.nextId,
      ...input,
      createdAt: now,
      updatedAt: now,
      internalRevision: ++this.revision,
    };

    this.nextId += 1;
    this.products.set(product.id, product);

    return product;
  }

  findAll(query: ListProductsQueryDto): ProductRecord[] {
    const normalizedSearch = query.search?.toLowerCase();
    const filtered = [...this.products.values()].filter((product) => {
      const matchesSearch =
        normalizedSearch === undefined ||
        product.name.toLowerCase().includes(normalizedSearch);
      const matchesActive =
        query.active === undefined || product.active === query.active;

      return matchesSearch && matchesActive;
    });

    return filtered.slice(query.offset, query.offset + query.limit);
  }

  findOne(id: number): ProductRecord {
    const product = this.products.get(id);

    if (product === undefined) {
      throw new NotFoundException(`Product ${id} was not found`);
    }

    return product;
  }

  getSummary(): ProductSummaryRecord {
    return {
      count: this.products.size,
      internalRevision: this.revision,
    };
  }
}
