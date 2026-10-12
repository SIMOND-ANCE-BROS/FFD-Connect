import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { MAX_SEAT_PRICE_CENTS } from "../../payment/seat-pricing";

/** Upper bound on the number of elements of a seat layout. */
export const MAX_LAYOUT_ITEMS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Error of one layout element, or `null` when it is valid. */
function layoutItemError(item: unknown, index: number): string | null {
  if (!isRecord(item)) return `layout[${index}] must be an object`;
  if (item.id !== undefined && typeof item.id !== "string") {
    return `layout[${index}].id must be a string`;
  }
  const price = item.priceCents;
  if (
    price !== undefined &&
    (typeof price !== "number" ||
      !Number.isInteger(price) ||
      price < 1 ||
      price > MAX_SEAT_PRICE_CENTS)
  ) {
    return `layout[${index}].priceCents must be an integer between 1 and ${MAX_SEAT_PRICE_CENTS} (cents)`;
  }
  return null;
}

/**
 * Seat layout of a competition (#381). Elements are free-form objects drawn
 * by the club editor (`id`, `type`, `label`, `x`, `y`, `lockedSeats`…) and
 * pass through as before; only what the server relies on is enforced: an
 * array of at most MAX_LAYOUT_ITEMS objects, a string `id`, and an optional
 * `priceCents` — the seat price charged by the HelloAsso checkout — that is
 * an integer number of cents between 1 and MAX_SEAT_PRICE_CENTS.
 */
@ValidatorConstraint({ name: "isSeatLayout", async: false })
export class SeatLayoutConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.length <= MAX_LAYOUT_ITEMS &&
      value.every((item, index) => layoutItemError(item, index) === null)
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const value: unknown = args.value;
    if (!Array.isArray(value)) return "layout must be an array";
    if (value.length > MAX_LAYOUT_ITEMS) {
      return `layout must contain at most ${MAX_LAYOUT_ITEMS} elements`;
    }
    for (const [index, item] of value.entries()) {
      const error = layoutItemError(item, index);
      if (error) return error;
    }
    return "layout is invalid";
  }
}

export function IsSeatLayout(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: SeatLayoutConstraint,
    });
  };
}
