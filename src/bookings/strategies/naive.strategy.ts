import { Injectable } from '@nestjs/common';
import { NoCapacityError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  countOverlapping,
  insertHeld,
  type ReservedBooking,
  type ReserveInput,
  type ReserveStrategy,
} from './reserve.strategy';

/**
 * The bug, on purpose: check then insert with nothing holding the two together. Two concurrent
 * callers both count zero and both insert. Kept as the control the race test and the benchmark
 * run against; the configuration refuses it in production.
 */
@Injectable()
export class NaiveStrategy implements ReserveStrategy {
  readonly name = 'naive' as const;

  constructor(private readonly prisma: PrismaService) {}

  reserve(input: ReserveInput): Promise<ReservedBooking> {
    return this.prisma.$transaction(async (tx) => {
      if ((await countOverlapping(tx, input)) >= input.resource.capacity) {
        throw new NoCapacityError(input.resource.id);
      }
      return insertHeld(tx, input);
    });
  }
}
