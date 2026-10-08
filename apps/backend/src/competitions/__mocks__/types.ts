/**
 * Types de mock pour les tests
 * Ces types permettent d'éviter l'utilisation de `as any` ou `as unknown` dans les tests
 */

import { HttpService } from "@nestjs/axios";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Mock type-safe pour HttpService
 */
export type MockHttpService = Partial<Record<keyof HttpService, jest.Mock>>;

/**
 * Mock type-safe pour PrismaService
 */
export type MockPrismaService = Partial<
  Record<keyof PrismaService, jest.Mock>
> & {
  event: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    createMany: jest.Mock;
    updateMany: jest.Mock;
  };
  competition: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    findFirst: jest.Mock;
    upsert: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  registration: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
    aggregate: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  license: {
    findUnique: jest.Mock;
  };
  result: {
    findMany: jest.Mock;
  };
  volunteerToken: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
};

/**
 * Helper pour créer un mock HttpService type-safe
 */
export function createMockHttpService(): MockHttpService {
  return {
    get: jest.fn(),
  };
}

/**
 * Helper pour créer un mock PrismaService type-safe
 */
export function createMockPrismaService(): MockPrismaService {
  return {
    event: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
    competition: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    registration: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    license: {
      findUnique: jest.fn(),
    },
    result: {
      findMany: jest.fn(),
    },
    volunteerToken: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  } as MockPrismaService;
}
