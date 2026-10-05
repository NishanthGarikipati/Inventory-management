/**
 * Errors carry a shop-owner readable message plus optional actions the mobile
 * app can render as buttons. Never surface codes like INV_4027_EXCEPTION.
 */
export type ErrorAction = { label: string; action: string; payload?: Record<string, unknown> };

export class AppError extends Error {
  status: number;
  code: string;
  actions: ErrorAction[];
  details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { actions?: ErrorAction[]; details?: unknown } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.actions = options.actions ?? [];
    this.details = options.details;
  }
}

export const badRequest = (message: string, actions?: ErrorAction[]) =>
  new AppError(400, 'BAD_REQUEST', message, { actions });

export const unauthorized = (message = 'Please sign in again.') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have access to this action.') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (what: string) =>
  new AppError(404, 'NOT_FOUND', `${what} was not found.`);

export const conflict = (message: string, actions?: ErrorAction[]) =>
  new AppError(409, 'CONFLICT', message, { actions });

export const validationError = (message: string, details?: unknown) =>
  new AppError(422, 'VALIDATION_FAILED', message, { details });

export const insufficientStock = (
  productName: string,
  available: number,
  requested: number,
) =>
  new AppError(
    409,
    'INSUFFICIENT_STOCK',
    `Only ${available} available for ${productName}. You tried to use ${requested}.`,
    {
      actions: [
        { label: 'Change Quantity', action: 'CHANGE_QUANTITY', payload: { available } },
        { label: 'Allow Negative Stock', action: 'OPEN_SETTINGS' },
      ],
    },
  );
