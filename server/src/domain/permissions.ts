import type { UserRole } from './enums.js';

export const PERMISSIONS = {
  'product:read': 'View products',
  'product:write': 'Create and edit products',
  'product:delete': 'Delete products',
  'inventory:read': 'View stock',
  'inventory:adjust': 'Adjust stock',
  'sale:read': 'View sales',
  'sale:create': 'Make sales',
  'sale:cancel': 'Cancel sales',
  'sale:return': 'Accept sale returns',
  'purchase:read': 'View purchases',
  'purchase:write': 'Record purchases',
  'purchase:return': 'Return goods to supplier',
  'customer:read': 'View customers',
  'customer:write': 'Add and edit customers',
  'supplier:read': 'View suppliers',
  'supplier:write': 'Add and edit suppliers',
  'payment:create': 'Record payments',
  'expense:read': 'View expenses',
  'expense:write': 'Record expenses',
  'report:read': 'View reports',
  'scanner:use': 'Use the smart scanner',
  'scanner:approve': 'Approve scanned stock changes',
  'settings:read': 'View settings',
  'settings:write': 'Change settings',
  'user:manage': 'Manage staff',
  'audit:read': 'View activity log',
  'closing:write': 'Close the day',
} as const;

export type Permission = keyof typeof PERMISSIONS;

const MANAGER_PERMISSIONS: Permission[] = [
  'product:read',
  'product:write',
  'inventory:read',
  'inventory:adjust',
  'sale:read',
  'sale:create',
  'sale:cancel',
  'sale:return',
  'purchase:read',
  'purchase:write',
  'purchase:return',
  'customer:read',
  'customer:write',
  'supplier:read',
  'supplier:write',
  'payment:create',
  'expense:read',
  'expense:write',
  'report:read',
  'scanner:use',
  'scanner:approve',
  'settings:read',
  'closing:write',
];

const CASHIER_PERMISSIONS: Permission[] = [
  'product:read',
  'inventory:read',
  'sale:read',
  'sale:create',
  'customer:read',
  'customer:write',
  'payment:create',
  'scanner:use',
];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  OWNER: Object.keys(PERMISSIONS) as Permission[],
  MANAGER: MANAGER_PERMISSIONS,
  CASHIER: CASHIER_PERMISSIONS,
};

export const ROLE_DESCRIPTIONS: Record<UserRole, { name: string; description: string }> = {
  OWNER: { name: 'Owner', description: 'Full access to everything' },
  MANAGER: { name: 'Manager', description: 'Sells, purchases, stock, customers, suppliers and reports' },
  CASHIER: { name: 'Cashier', description: 'Billing counter: sell, look up products, pick customers' },
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
