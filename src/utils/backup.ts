import type {
  AppNotification,
  BusinessProfile,
  Customer,
  InventoryItem,
  Invoice,
  PurchaseOrder,
  Supplier,
  TransactionItem,
} from '@/src/context/AppDataContext';

export interface CategoryDoc {
  id: string;
  name: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface BackupSummary {
  inventoryCount: number;
  categoriesCount: number;
  customersCount: number;
  suppliersCount: number;
  invoicesCount: number;
  purchasesCount: number;
  notificationsCount: number;
}

export interface FullSystemBackup {
  app: 'Doctor Tools';
  backupVersion: 1;
  exportedAt: string;
  summary: BackupSummary;
  data: {
    businessProfile: BusinessProfile;
    categories: string[];
    categoriesDocs: CategoryDoc[];
    inventory: InventoryItem[];
    customers: Customer[];
    suppliers: Supplier[];
    invoices: Invoice[];
    purchases: PurchaseOrder[];
    notifications: AppNotification[];
  };
  settings?: {
    theme?: 'light' | 'dark' | 'system';
    authPassword?: string;
  };
}

export interface ParsedBackupResult {
  valid: boolean;
  error?: string;
  backup?: FullSystemBackup;
}

const VALID_FIRESTORE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidFirestoreId(id: unknown): id is string {
  return typeof id === 'string' && VALID_FIRESTORE_ID_REGEX.test(id);
}

function makeValidId(prefix: string, index: number): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${index}_${rand}`.slice(0, 128);
}

function safeString(val: unknown, fallback: string, maxLen: number): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val;
  if (trimmed.length === 0) return fallback;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function safeOptionalString(val: unknown, fallback: string, maxLen: number): string {
  if (typeof val !== 'string') return fallback;
  return val.length > maxLen ? val.slice(0, maxLen) : val;
}

function safeNumber(val: unknown, fallback = 0): number {
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) ? num : fallback;
}

function safeTimestamp(val: unknown, fallback: number): number {
  const num = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function sanitizeTransactionItems(
  rawItems: unknown,
  inventoryIdMap: Map<string, string>
): TransactionItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === 'object'))
    .map((it) => {
      const rawId = typeof it.itemId === 'string' ? it.itemId : '';
      const mappedId = inventoryIdMap.get(rawId) || (isValidFirestoreId(rawId) ? rawId : 'unknown_item');
      return {
        itemId: mappedId.slice(0, 128),
        quantity: safeNumber(it.quantity, 0),
        price: safeNumber(it.price, 0),
      };
    });
}

export function buildFullSystemBackup(params: {
  businessProfile: BusinessProfile;
  categories: string[];
  categoriesDocs: CategoryDoc[];
  inventory: InventoryItem[];
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  purchases: PurchaseOrder[];
  notifications: AppNotification[];
  theme?: 'light' | 'dark' | 'system';
  authPassword?: string;
}): FullSystemBackup {
  const storedNotifications = params.notifications.filter(
    (n) => !String(n.id || '').startsWith('low-stock-')
  );

  const normalizedCategoriesDocs: CategoryDoc[] = params.categories.map((name, idx) => {
    const existing = params.categoriesDocs.find((c) => c.name === name);
    return {
      id: existing && isValidFirestoreId(existing.id) ? existing.id : `cat_${idx + 1}`,
      name,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: existing?.updatedAt || Date.now(),
    };
  });

  const backup: FullSystemBackup = {
    app: 'Doctor Tools',
    backupVersion: 1,
    exportedAt: new Date().toISOString(),
    summary: {
      inventoryCount: params.inventory.length,
      categoriesCount: params.categories.length,
      customersCount: params.customers.length,
      suppliersCount: params.suppliers.length,
      invoicesCount: params.invoices.length,
      purchasesCount: params.purchases.length,
      notificationsCount: storedNotifications.length,
    },
    data: {
      businessProfile: {
        name: params.businessProfile.name || 'Doctor Tools',
        phone: params.businessProfile.phone || '',
        address: params.businessProfile.address || 'القاهرة، مصر',
        description: params.businessProfile.description || '',
        logo: params.businessProfile.logo || null,
        createdAt: params.businessProfile.createdAt,
        updatedAt: params.businessProfile.updatedAt,
      },
      categories: [...params.categories],
      categoriesDocs: normalizedCategoriesDocs,
      inventory: [...params.inventory],
      customers: [...params.customers],
      suppliers: [...params.suppliers],
      invoices: [...params.invoices],
      purchases: [...params.purchases],
      notifications: storedNotifications,
    },
    settings: {
      ...(params.theme ? { theme: params.theme } : {}),
      ...(params.authPassword ? { authPassword: params.authPassword } : {}),
    },
  };

  return backup;
}

export function parseAndValidateBackup(rawText: string): ParsedBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      valid: false,
      error: 'ملف النسخة الاحتياطية غير صالح: تأكد من أنه ملف JSON سليم ولم يتلف.',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      error: 'صيغة الملف غير مدعومة. يجب أن يحتوي الملف على بيانات النسخة الاحتياطية للنظام.',
    };
  }

  const root = parsed as Record<string, unknown>;
  const dataObj =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;

  const hasKnownKey = [
    'inventory',
    'customers',
    'suppliers',
    'invoices',
    'purchases',
    'categories',
    'categoriesDocs',
    'businessProfile',
    'notifications',
  ].some((k) => k in dataObj);

  if (!hasKnownKey) {
    return {
      valid: false,
      error: 'هذا الملف لا يحتوي على بيانات نظام Doctor Tools صالحة.',
    };
  }

  const now = Date.now();

  // 1. Inventory (and build oldId -> validId map)
  const inventoryIdMap = new Map<string, string>();
  const rawInventory = Array.isArray(dataObj.inventory) ? dataObj.inventory : [];
  const inventory: InventoryItem[] = rawInventory
    .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === 'object'))
    .map((it, idx) => {
      const origId = typeof it.id === 'string' ? it.id : '';
      const validId = isValidFirestoreId(origId) ? origId : makeValidId('inv', idx);
      if (origId) inventoryIdMap.set(origId, validId);
      const createdAt = safeTimestamp(it.createdAt, now - idx);
      const updatedAt = safeTimestamp(it.updatedAt, createdAt);
      return {
        id: validId,
        code: safeString(it.code, `ITEM-${idx + 1}`, 100),
        name: safeString(it.name, `صنف ${idx + 1}`, 200),
        brand: safeOptionalString(it.brand, '', 100),
        compatibleCars: safeOptionalString(it.compatibleCars, '', 200),
        category: safeString(it.category, 'أخرى', 100),
        storageLocation: safeOptionalString(it.storageLocation, '', 100),
        quantity: safeNumber(it.quantity, 0),
        purchasePrice: safeNumber(it.purchasePrice, 0),
        sellPrice: safeNumber(it.sellPrice, 0),
        createdAt,
        updatedAt,
      };
    });

  // 2. Categories
  const categoryMap = new Map<string, CategoryDoc>();
  const rawCatsDocs = Array.isArray(dataObj.categoriesDocs) ? dataObj.categoriesDocs : [];
  rawCatsDocs.forEach((c, idx) => {
    if (c && typeof c === 'object') {
      const obj = c as Record<string, unknown>;
      const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 100) : '';
      if (name && !categoryMap.has(name)) {
        const createdAt = safeTimestamp(obj.createdAt, now);
        categoryMap.set(name, {
          id: isValidFirestoreId(obj.id) ? obj.id : makeValidId('cat', idx),
          name,
          createdAt,
          updatedAt: safeTimestamp(obj.updatedAt, createdAt),
        });
      }
    }
  });

  const rawCats = Array.isArray(dataObj.categories) ? dataObj.categories : [];
  rawCats.forEach((c, idx) => {
    const name = typeof c === 'string' ? c.trim().slice(0, 100) : '';
    if (name && !categoryMap.has(name)) {
      categoryMap.set(name, {
        id: makeValidId('cat', rawCatsDocs.length + idx),
        name,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  // Ensure any category referenced by inventory exists
  inventory.forEach((item, idx) => {
    const catName = item.category.trim().slice(0, 100);
    if (catName && !categoryMap.has(catName)) {
      categoryMap.set(catName, {
        id: makeValidId('cat', 1000 + idx),
        name: catName,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  const categoriesDocs = Array.from(categoryMap.values());
  const categories = categoriesDocs.map((c) => c.name);

  // 3. Customers
  const customerIdMap = new Map<string, string>();
  const rawCustomers = Array.isArray(dataObj.customers) ? dataObj.customers : [];
  const customers: Customer[] = rawCustomers
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
    .map((c, idx) => {
      const origId = typeof c.id === 'string' ? c.id : '';
      const validId = isValidFirestoreId(origId) ? origId : makeValidId('cust', idx);
      if (origId) customerIdMap.set(origId, validId);
      const createdAt = safeTimestamp(c.createdAt, now - idx);
      const updatedAt = safeTimestamp(c.updatedAt, createdAt);
      return {
        id: validId,
        serialNumber: safeString(c.serialNumber, `CUST-${1000 + idx + 1}`, 50),
        name: safeString(c.name, `عميل ${idx + 1}`, 100),
        phone: safeOptionalString(c.phone, '', 50),
        balance: safeNumber(c.balance, 0),
        createdAt,
        updatedAt,
      };
    });

  // 4. Suppliers
  const supplierIdMap = new Map<string, string>();
  const rawSuppliers = Array.isArray(dataObj.suppliers) ? dataObj.suppliers : [];
  const suppliers: Supplier[] = rawSuppliers
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
    .map((s, idx) => {
      const origId = typeof s.id === 'string' ? s.id : '';
      const validId = isValidFirestoreId(origId) ? origId : makeValidId('sup', idx);
      if (origId) supplierIdMap.set(origId, validId);
      const createdAt = safeTimestamp(s.createdAt, now - idx);
      const updatedAt = safeTimestamp(s.updatedAt, createdAt);
      return {
        id: validId,
        name: safeString(s.name, `مورد ${idx + 1}`, 100),
        phone: safeOptionalString(s.phone, '', 50),
        balance: safeNumber(s.balance, 0),
        createdAt,
        updatedAt,
      };
    });

  // 5. Invoices
  const rawInvoices = Array.isArray(dataObj.invoices) ? dataObj.invoices : [];
  const invoices: Invoice[] = rawInvoices
    .filter((inv): inv is Record<string, unknown> => Boolean(inv && typeof inv === 'object'))
    .map((inv, idx) => {
      const validId = isValidFirestoreId(inv.id) ? inv.id : makeValidId('invdoc', idx);
      const rawCustId = typeof inv.customerId === 'string' ? inv.customerId : '';
      const mappedCustId =
        customerIdMap.get(rawCustId) || (rawCustId.length <= 128 ? rawCustId : rawCustId.slice(0, 128));
      const createdAt = safeTimestamp(inv.createdAt, now - idx);
      const updatedAt = safeTimestamp(inv.updatedAt, createdAt);

      const normalized: Invoice = {
        id: validId,
        invoiceNumber: safeString(inv.invoiceNumber, `INV-${1000 + idx + 1}`, 50),
        date: safeString(inv.date, new Date(createdAt).toISOString(), 50),
        customerId: mappedCustId,
        items: sanitizeTransactionItems(inv.items, inventoryIdMap),
        total: safeNumber(inv.total, 0),
        paid: safeNumber(inv.paid, 0),
        createdAt,
        updatedAt,
      };

      if (inv.discountType === 'percentage' || inv.discountType === 'fixed') {
        normalized.discountType = inv.discountType;
      }
      if (inv.discountValue !== undefined && inv.discountValue !== null && Number.isFinite(Number(inv.discountValue))) {
        normalized.discountValue = Number(inv.discountValue);
      }
      if (typeof inv.isQuote === 'boolean') {
        normalized.isQuote = inv.isQuote;
      }
      if (typeof inv.customCustomerName === 'string' && inv.customCustomerName.length > 0) {
        normalized.customCustomerName = inv.customCustomerName.slice(0, 200);
      }

      return normalized;
    });

  // 6. Purchases
  const rawPurchases = Array.isArray(dataObj.purchases) ? dataObj.purchases : [];
  const purchases: PurchaseOrder[] = rawPurchases
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
    .map((p, idx) => {
      const validId = isValidFirestoreId(p.id) ? p.id : makeValidId('pur', idx);
      const rawSupId = typeof p.supplierId === 'string' ? p.supplierId : '';
      const mappedSupId =
        supplierIdMap.get(rawSupId) || (rawSupId.length > 0 ? rawSupId.slice(0, 128) : 'unknown_supplier');
      const createdAt = safeTimestamp(p.createdAt, now - idx);
      const updatedAt = safeTimestamp(p.updatedAt, createdAt);

      return {
        id: validId,
        date: safeString(p.date, new Date(createdAt).toISOString(), 50),
        supplierId: mappedSupId,
        items: sanitizeTransactionItems(p.items, inventoryIdMap),
        total: safeNumber(p.total, 0),
        paid: safeNumber(p.paid, 0),
        createdAt,
        updatedAt,
      };
    });

  // 7. Notifications (exclude synthetic low-stock-* items)
  const rawNotifications = Array.isArray(dataObj.notifications) ? dataObj.notifications : [];
  const notifications: AppNotification[] = rawNotifications
    .filter((n): n is Record<string, unknown> => Boolean(n && typeof n === 'object'))
    .filter((n) => !String(n.id || '').startsWith('low-stock-'))
    .map((n, idx) => {
      const validId = isValidFirestoreId(n.id) ? n.id : makeValidId('notif', idx);
      const createdAt = safeTimestamp(n.createdAt, now - idx);
      const updatedAt = safeTimestamp(n.updatedAt, createdAt);
      return {
        id: validId,
        message: safeString(n.message, 'إشعار نظام', 500),
        date: safeString(n.date, new Date(createdAt).toISOString(), 50),
        read: Boolean(n.read),
        createdAt,
        updatedAt,
      };
    });

  // 8. Business Profile
  const rawProf =
    dataObj.businessProfile && typeof dataObj.businessProfile === 'object'
      ? (dataObj.businessProfile as Record<string, unknown>)
      : {};
  const profCreatedAt = safeTimestamp(rawProf.createdAt, now);
  const businessProfile: BusinessProfile = {
    name: safeString(rawProf.name, 'Doctor Tools', 100),
    phone: safeOptionalString(rawProf.phone, '', 50),
    address: safeString(rawProf.address, 'القاهرة، مصر', 200),
    description: safeOptionalString(rawProf.description, 'نظام إدارة العيادات والمستلزمات الطبية المتكامل', 500),
    logo:
      typeof rawProf.logo === 'string' && rawProf.logo.length > 0 && rawProf.logo.length <= 10_000_000
        ? rawProf.logo
        : null,
    createdAt: profCreatedAt,
    updatedAt: safeTimestamp(rawProf.updatedAt, profCreatedAt),
  };

  // 9. Settings
  const rawSettings =
    root.settings && typeof root.settings === 'object' ? (root.settings as Record<string, unknown>) : {};
  const settings: FullSystemBackup['settings'] = {};
  if (rawSettings.theme === 'light' || rawSettings.theme === 'dark' || rawSettings.theme === 'system') {
    settings.theme = rawSettings.theme;
  }
  if (typeof rawSettings.authPassword === 'string' && rawSettings.authPassword.length > 0) {
    settings.authPassword = rawSettings.authPassword;
  }

  const exportedAt =
    typeof root.exportedAt === 'string' && root.exportedAt.length > 0
      ? root.exportedAt
      : new Date().toISOString();

  return {
    valid: true,
    backup: {
      app: 'Doctor Tools',
      backupVersion: 1,
      exportedAt,
      summary: {
        inventoryCount: inventory.length,
        categoriesCount: categories.length,
        customersCount: customers.length,
        suppliersCount: suppliers.length,
        invoicesCount: invoices.length,
        purchasesCount: purchases.length,
        notificationsCount: notifications.length,
      },
      data: {
        businessProfile,
        categories,
        categoriesDocs,
        inventory,
        customers,
        suppliers,
        invoices,
        purchases,
        notifications,
      },
      settings,
    },
  };
}
