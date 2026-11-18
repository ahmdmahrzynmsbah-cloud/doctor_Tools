import React, { createContext, useContext, useState, ReactNode, useMemo, useEffect, useCallback, useRef } from 'react';
import { db } from '../lib/firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, getDocs, getDoc, type WriteBatch } from 'firebase/firestore';
import { buildFullSystemBackup, type FullSystemBackup, type BackupSummary } from '../utils/backup';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

// Ensure no stale quota lockout key is present
try {
  localStorage.removeItem('firestore_quota_exhausted_until');
} catch {}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errStr = error instanceof Error ? error.message : String(error);
  console.warn(`[Firestore ${operationType} on ${path}]`, errStr);
}

// Background Firestore writer with instantaneous local reactivity
function safeFirestoreOperation(operation: () => Promise<void>, path: string, opType: OperationType = OperationType.WRITE) {
  operation().catch(err => {
    handleFirestoreError(err, opType, path);
  });
}

const loadStorage = <T,>(key: string, fallback: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch {
    return fallback;
  }
};

const saveStorageDebounced = (() => {
  const timers: Record<string, ReturnType<typeof setTimeout>> = {};
  return <T,>(key: string, data: T, delay = 200) => {
    if (timers[key]) clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {
        console.warn('LocalStorage save failed:', e);
      }
    }, delay);
  };
})();

export type InventoryItem = {
  id: string;
  code: string;
  name: string;
  brand: string;
  compatibleCars: string;
  category: string;
  storageLocation: string;
  quantity: number;
  purchasePrice: number;
  sellPrice: number;
  createdAt?: number;
  updatedAt?: number;
};

export type Customer = {
  id: string;
  serialNumber: string;
  name: string;
  phone: string;
  balance: number;
  createdAt?: number;
  updatedAt?: number;
};

export type Supplier = {
  id: string;
  name: string;
  phone: string;
  balance: number;
  createdAt?: number;
  updatedAt?: number;
};

export type TransactionItem = {
  itemId: string;
  quantity: number;
  price: number;
};

export type Invoice = {
  id: string;
  invoiceNumber: string;
  date: string;
  customerId: string;
  items: TransactionItem[];
  total: number;
  paid: number;
  discountType?: 'percentage' | 'fixed';
  discountValue?: number;
  createdAt?: number;
  updatedAt?: number;
  isQuote?: boolean;
  customCustomerName?: string;
};

export type PurchaseOrder = {
  id: string;
  date: string;
  supplierId: string;
  items: TransactionItem[];
  total: number;
  paid: number;
  createdAt?: number;
  updatedAt?: number;
};

export type AppNotification = {
  id: string;
  message: string;
  date: string;
  read: boolean;
  createdAt?: number;
  updatedAt?: number;
};

export type BusinessProfile = {
  name: string;
  phone: string;
  address: string;
  description?: string;
  logo: string | null;
  createdAt?: number;
  updatedAt?: number;
};

type Category = {
  id: string;
  name: string;
};

type AppDataContextType = {
  inventory: InventoryItem[];
  categories: string[];
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  purchases: PurchaseOrder[];
  notifications: AppNotification[];
  businessProfile: BusinessProfile;
  syncStatus: 'synced' | 'syncing' | 'error';
  isLiveSyncActive: boolean;
  lastSyncTime: Date | null;
  syncNow: () => Promise<void>;
  
  addInventoryItem: (item: Omit<InventoryItem, 'id'>) => Promise<string>;
  updateInventoryItem: (id: string, item: Omit<InventoryItem, 'id'>) => Promise<void>;
  deleteInventoryItem: (id: string) => Promise<void>;
  
  addCategory: (category: string) => Promise<void>;
  removeCategory: (category: string) => Promise<void>;
  
  addCustomer: (customer: Omit<Customer, 'id' | 'serialNumber'>) => Promise<string>;
  updateCustomer: (id: string, customer: Omit<Customer, 'id' | 'serialNumber'>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  addSupplier: (supplier: Omit<Supplier, 'id'>) => Promise<void>;
  updateSupplier: (id: string, supplier: Omit<Supplier, 'id'>) => Promise<void>;
  deleteSupplier: (id: string) => Promise<void>;
  
  createInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber'>) => Promise<void>;
  updateInvoice: (id: string, invoice: Omit<Invoice, 'id' | 'invoiceNumber'>) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  
  createPurchase: (purchase: Omit<PurchaseOrder, 'id'>) => Promise<void>;
  recordCustomerPayment: (customerId: string, amount: number) => Promise<void>;
  recordSupplierPayment: (supplierId: string, amount: number) => Promise<void>;
  
  markAllNotificationsRead: () => Promise<void>;
  updateBusinessProfile: (profile: BusinessProfile) => Promise<void>;

  exportFullBackup: (options?: { includePassword?: boolean }) => FullSystemBackup;
  restoreFullBackup: (
    backup: FullSystemBackup,
    mode: 'replace' | 'merge',
    options?: { restorePassword?: boolean }
  ) => Promise<{
    success: boolean;
    cloudSynced: boolean;
    cloudError?: string;
    counts: BackupSummary;
  }>;
};

const AppDataContext = createContext<AppDataContextType | undefined>(undefined);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const uid = 'main_store';
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error'>('synced');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(new Date());
  const initialSyncExecuted = useRef(false);
  const isRestoringRef = useRef(false);

  const [categories, setCategories] = useState<string[]>(() => 
    loadStorage('doctor_tools_categories', ["فلاتر", "فرامل", "كهرباء", "زيوت", "إطارات", "عادم", "تعليق", "أخرى"])
  );
  
  const [categoriesDocs, setCategoriesDocs] = useState<Category[]>(() =>
    loadStorage('doctor_tools_categories_docs', [])
  );
  
  const [inventory, setInventory] = useState<InventoryItem[]>(() => {
    const list = loadStorage<InventoryItem[]>('doctor_tools_inventory', []);
    return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  });
  
  const [customers, setCustomers] = useState<Customer[]>(() => {
    const list = loadStorage<Customer[]>('doctor_tools_customers', []);
    return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  });
  
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const list = loadStorage<Supplier[]>('doctor_tools_suppliers', []);
    return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  });
  
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    const list = loadStorage<Invoice[]>('doctor_tools_invoices', []);
    return [...list].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  });
  
  const [purchases, setPurchases] = useState<PurchaseOrder[]>(() => {
    const list = loadStorage<PurchaseOrder[]>('doctor_tools_purchases', []);
    return [...list].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  });
  
  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    loadStorage('doctor_tools_notifications', [])
  );
  
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(() => {
    const stored = loadStorage<BusinessProfile>('doctor_tools_profile', {
      name: 'Doctor Tools',
      phone: '',
      address: 'القاهرة، مصر',
      description: 'نظام إدارة العيادات والمستلزمات الطبية المتكامل',
      logo: '/logo.png'
    });
    // Remove hardcoded placeholder phone if user hasn't set their own
    if (stored.phone === '01000000000') {
      stored.phone = '';
    }
    if (!stored.logo) {
      stored.logo = '/logo.png';
    }
    return stored;
  });

  // Sync to localStorage smoothly via debounced non-blocking batcher
  useEffect(() => { saveStorageDebounced('doctor_tools_inventory', inventory); }, [inventory]);
  useEffect(() => { saveStorageDebounced('doctor_tools_categories', categories); }, [categories]);
  useEffect(() => { saveStorageDebounced('doctor_tools_categories_docs', categoriesDocs); }, [categoriesDocs]);
  useEffect(() => { saveStorageDebounced('doctor_tools_customers', customers); }, [customers]);
  useEffect(() => { saveStorageDebounced('doctor_tools_suppliers', suppliers); }, [suppliers]);
  useEffect(() => { saveStorageDebounced('doctor_tools_invoices', invoices); }, [invoices]);
  useEffect(() => { saveStorageDebounced('doctor_tools_purchases', purchases); }, [purchases]);
  useEffect(() => { saveStorageDebounced('doctor_tools_notifications', notifications); }, [notifications]);
  useEffect(() => { saveStorageDebounced('doctor_tools_profile', businessProfile); }, [businessProfile]);

  // Comprehensive bi-directional sync method (pulls remote, pushes offline-created local items)
  const syncNow = useCallback(async () => {
    if (isRestoringRef.current) return;
    setSyncStatus('syncing');
    try {
      // 1. Inventory Sync
      const invSnap = await getDocs(collection(db, 'users', uid, 'inventory'));
      const remoteInvMap = new Map<string, InventoryItem>();
      invSnap.docs.forEach(d => {
        remoteInvMap.set(d.id, { ...d.data(), id: d.id } as InventoryItem);
      });
      const localInv = loadStorage<InventoryItem[]>('doctor_tools_inventory', []);
      for (const item of localInv) {
        if (!remoteInvMap.has(item.id)) {
          await setDoc(doc(db, 'users', uid, 'inventory', item.id), {
            ...item,
            ownerId: uid,
            createdAt: item.createdAt || Date.now(),
            updatedAt: item.updatedAt || Date.now()
          }, { merge: true });
          remoteInvMap.set(item.id, item);
        }
      }
      const mergedInv = Array.from(remoteInvMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setInventory(mergedInv);
      saveStorageDebounced('doctor_tools_inventory', mergedInv, 0);

      // 2. Customers Sync
      const custSnap = await getDocs(collection(db, 'users', uid, 'customers'));
      const remoteCustMap = new Map<string, Customer>();
      custSnap.docs.forEach(d => {
        remoteCustMap.set(d.id, { ...d.data(), id: d.id } as Customer);
      });
      const localCust = loadStorage<Customer[]>('doctor_tools_customers', []);
      for (const c of localCust) {
        if (!remoteCustMap.has(c.id)) {
          await setDoc(doc(db, 'users', uid, 'customers', c.id), {
            ...c,
            ownerId: uid,
            createdAt: c.createdAt || Date.now(),
            updatedAt: c.updatedAt || Date.now()
          }, { merge: true });
          remoteCustMap.set(c.id, c);
        }
      }
      const mergedCust = Array.from(remoteCustMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setCustomers(mergedCust);
      saveStorageDebounced('doctor_tools_customers', mergedCust, 0);

      // 3. Suppliers Sync
      const supSnap = await getDocs(collection(db, 'users', uid, 'suppliers'));
      const remoteSupMap = new Map<string, Supplier>();
      supSnap.docs.forEach(d => {
        remoteSupMap.set(d.id, { ...d.data(), id: d.id } as Supplier);
      });
      const localSup = loadStorage<Supplier[]>('doctor_tools_suppliers', []);
      for (const s of localSup) {
        if (!remoteSupMap.has(s.id)) {
          await setDoc(doc(db, 'users', uid, 'suppliers', s.id), {
            ...s,
            ownerId: uid,
            createdAt: s.createdAt || Date.now(),
            updatedAt: s.updatedAt || Date.now()
          }, { merge: true });
          remoteSupMap.set(s.id, s);
        }
      }
      const mergedSup = Array.from(remoteSupMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setSuppliers(mergedSup);
      saveStorageDebounced('doctor_tools_suppliers', mergedSup, 0);

      // 4. Invoices Sync
      const invsSnap = await getDocs(collection(db, 'users', uid, 'invoices'));
      const remoteInvsMap = new Map<string, Invoice>();
      invsSnap.docs.forEach(d => {
        remoteInvsMap.set(d.id, { ...d.data(), id: d.id } as Invoice);
      });
      const localInvs = loadStorage<Invoice[]>('doctor_tools_invoices', []);
      for (const inv of localInvs) {
        if (!remoteInvsMap.has(inv.id)) {
          await setDoc(doc(db, 'users', uid, 'invoices', inv.id), {
            ...inv,
            ownerId: uid,
            createdAt: inv.createdAt || Date.now(),
            updatedAt: inv.updatedAt || Date.now()
          }, { merge: true });
          remoteInvsMap.set(inv.id, inv);
        }
      }
      const mergedInvs = Array.from(remoteInvsMap.values()).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      setInvoices(mergedInvs);
      saveStorageDebounced('doctor_tools_invoices', mergedInvs, 0);

      // 5. Purchases Sync
      const purSnap = await getDocs(collection(db, 'users', uid, 'purchases'));
      const remotePurMap = new Map<string, PurchaseOrder>();
      purSnap.docs.forEach(d => {
        remotePurMap.set(d.id, { ...d.data(), id: d.id } as PurchaseOrder);
      });
      const localPur = loadStorage<PurchaseOrder[]>('doctor_tools_purchases', []);
      for (const p of localPur) {
        if (!remotePurMap.has(p.id)) {
          await setDoc(doc(db, 'users', uid, 'purchases', p.id), {
            ...p,
            ownerId: uid,
            createdAt: p.createdAt || Date.now(),
            updatedAt: p.updatedAt || Date.now()
          }, { merge: true });
          remotePurMap.set(p.id, p);
        }
      }
      const mergedPur = Array.from(remotePurMap.values()).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
      setPurchases(mergedPur);
      saveStorageDebounced('doctor_tools_purchases', mergedPur, 0);

      // 6. Categories Sync
      const catSnap = await getDocs(collection(db, 'users', uid, 'categories'));
      if (!catSnap.empty) {
        const cats = catSnap.docs.map(t => ({ id: t.id, name: t.data().name }));
        setCategoriesDocs(cats);
        const catNames = cats.map(c => c.name);
        setCategories(catNames);
        saveStorageDebounced('doctor_tools_categories', catNames, 0);
      }

      setSyncStatus('synced');
      setLastSyncTime(new Date());
    } catch (err) {
      console.warn('Sync reconciliation finished:', err);
      setSyncStatus('synced');
      setLastSyncTime(new Date());
    }
  }, [uid]);

  // Initial sync once on mount
  useEffect(() => {
    if (!initialSyncExecuted.current) {
      initialSyncExecuted.current = true;
      syncNow();
    }
  }, [syncNow]);

  // Firestore Real-Time Live Sync Listeners across all devices
  useEffect(() => {
    let active = true;
    setSyncStatus('syncing');

    const unsubs = [
      onSnapshot(doc(db, 'users', uid, 'profile', 'businessProfile'), (docSnap) => {
        if (!active || isRestoringRef.current) return;
        setSyncStatus('synced');
        setLastSyncTime(new Date());
        if (docSnap.exists()) {
          const prof = docSnap.data() as BusinessProfile;
          setBusinessProfile(prof);
          saveStorageDebounced('doctor_tools_profile', prof, 0);
        }
      }, (e) => {
        handleFirestoreError(e, OperationType.GET, `users/${uid}/profile`);
      }),

      onSnapshot(collection(db, 'users', uid, 'categories'), (snap) => {
        if (!active || isRestoringRef.current) return;
        setSyncStatus('synced');
        setLastSyncTime(new Date());
        if (!snap.empty) {
          const cats = snap.docs.map(t => ({ id: t.id, name: t.data().name }));
          setCategoriesDocs(cats);
          if (cats.length > 0) {
            const catNames = cats.map(c => c.name);
            setCategories(catNames);
            saveStorageDebounced('doctor_tools_categories', catNames, 0);
          }
        }
      }, (e) => {
        handleFirestoreError(e, OperationType.LIST, `users/${uid}/categories`);
      }),

      onSnapshot(collection(db, 'users', uid, 'inventory'), (snap) => {
        if (!active || isRestoringRef.current) return;
        setSyncStatus('synced');
        setLastSyncTime(new Date());
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as InventoryItem))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setInventory(list);
        saveStorageDebounced('doctor_tools_inventory', list, 0);
      }, (e) => {
        handleFirestoreError(e, OperationType.LIST, `users/${uid}/inventory`);
      }),

      onSnapshot(collection(db, 'users', uid, 'customers'), (snap) => {
        if (!active || isRestoringRef.current) return;
        setSyncStatus('synced');
        setLastSyncTime(new Date());
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as Customer))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setCustomers(list);
        saveStorageDebounced('doctor_tools_customers', list, 0);
      }, (e) => {
        handleFirestoreError(e, OperationType.LIST, `users/${uid}/customers`);
      }),

      onSnapshot(collection(db, 'users', uid, 'suppliers'), (snap) => {
        if (!active || isRestoringRef.current) return;
        setSyncStatus('synced');
        setLastSyncTime(new Date());
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as Supplier))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setSuppliers(list);
        saveStorageDebounced('doctor_tools_suppliers', list, 0);
      }, (e) => {
        handleFirestoreError(e, OperationType.LIST, `users/${uid}/suppliers`);
      }),

      onSnapshot(collection(db, 'users', uid, 'invoices'), (snap) => {
        if (!active || isRestoringRef.current) return;
        setSyncStatus('synced');
        setLastSyncTime(new Date());
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as Invoice))
          .sort((a,b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        setInvoices(list);
        saveStorageDebounced('doctor_tools_invoices', list, 0);
      }, (e) => {
        handleFirestoreError(e, OperationType.LIST, `users/${uid}/invoices`);
      }),

      onSnapshot(collection(db, 'users', uid, 'purchases'), (snap) => {
        if (!active || isRestoringRef.current) return;
        setSyncStatus('synced');
        setLastSyncTime(new Date());
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as PurchaseOrder))
          .sort((a,b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        setPurchases(list);
        saveStorageDebounced('doctor_tools_purchases', list, 0);
      }, (e) => {
        handleFirestoreError(e, OperationType.LIST, `users/${uid}/purchases`);
      }),

      onSnapshot(collection(db, 'users', uid, 'notifications'), (snap) => {
        if (!active || isRestoringRef.current) return;
        setSyncStatus('synced');
        setLastSyncTime(new Date());
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id } as AppNotification));
        setNotifications(list);
        saveStorageDebounced('doctor_tools_notifications', list, 0);
      }, (e) => {
        handleFirestoreError(e, OperationType.LIST, `users/${uid}/notifications`);
      })
    ];

    return () => {
      active = false;
      unsubs.forEach(unsub => {
        try { unsub(); } catch {}
      });
    };
  }, [uid]);

  const lowStockThreshold = 10;
  const currentNotifications = useMemo(() => {
    const lowStockAlerts = inventory
      .filter(i => i.quantity <= lowStockThreshold)
      .map(i => ({
        id: `low-stock-${i.id}`,
        message: `تنبيه: صنف (${i.name}) قارب على الانتهاء. المتبقي: ${i.quantity}`,
        date: new Date().toISOString(),
        read: false
      }));
    
    return [...notifications, ...lowStockAlerts];
  }, [inventory, notifications]);

  const addInventoryItem = useCallback(async (item: Omit<InventoryItem, 'id'>): Promise<string> => {
    const cleanedItem = Object.fromEntries(
      Object.entries(item).map(([k, v]) => [k, v === undefined ? '' : v])
    ) as Omit<InventoryItem, 'id'>;
    
    const now = Date.now();
    const newRef = doc(collection(db, 'users', uid, 'inventory'));
    const newId = newRef.id;

    const newItem: InventoryItem = {
      ...cleanedItem,
      id: newId,
      createdAt: now,
      updatedAt: now
    } as InventoryItem;

    setInventory(prev => {
      const updated = [newItem, ...prev.filter(i => i.id !== newId)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      try {
        localStorage.setItem('doctor_tools_inventory', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      await setDoc(newRef, { ...cleanedItem, ownerId: uid, createdAt: now, updatedAt: now });
    }, `inventory/${newId}`);

    return newId;
  }, [uid]);
  
  const updateInventoryItem = useCallback(async (id: string, item: Omit<InventoryItem, 'id'>) => {
    const cleanedItem = Object.fromEntries(
      Object.entries(item).map(([k, v]) => [k, v === undefined ? '' : v])
    ) as Omit<InventoryItem, 'id'>;

    const now = Date.now();
    setInventory(prev => {
      const updated = prev.map(inv => inv.id === id ? { ...inv, ...cleanedItem, updatedAt: now } : inv);
      try {
        localStorage.setItem('doctor_tools_inventory', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      await setDoc(doc(db, 'users', uid, 'inventory', id), { ...cleanedItem, ownerId: uid, updatedAt: now }, { merge: true });
    }, `inventory/${id}`);
  }, [uid]);
  
  const deleteInventoryItem = useCallback(async (id: string) => {
    setInventory(prev => {
      const updated = prev.filter(inv => inv.id !== id);
      try {
        localStorage.setItem('doctor_tools_inventory', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      await deleteDoc(doc(db, 'users', uid, 'inventory', id));
    }, `inventory/${id}`, OperationType.DELETE);
  }, [uid]);

  const addCategory = useCallback(async (category: string) => {
    const catName = category.trim();
    if (!catName) return;

    setCategories(prev => {
      const updated = prev.includes(catName) ? prev : [...prev, catName];
      try { localStorage.setItem('doctor_tools_categories', JSON.stringify(updated)); } catch {}
      return updated;
    });
    const newCatId = `cat_${Date.now()}`;
    setCategoriesDocs(prev => {
      const updated = prev.some(c => c.name === catName) ? prev : [...prev, { id: newCatId, name: catName }];
      try { localStorage.setItem('doctor_tools_categories_docs', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      const newRef = doc(collection(db, 'users', uid, 'categories'));
      await setDoc(newRef, { ownerId: uid, name: catName, createdAt: Date.now(), updatedAt: Date.now() });
    }, 'categories');
  }, [uid]);
  
  const removeCategory = useCallback(async (categoryName: string) => {
    setCategories(prev => {
      const updated = prev.filter(c => c !== categoryName);
      try { localStorage.setItem('doctor_tools_categories', JSON.stringify(updated)); } catch {}
      return updated;
    });
    setCategoriesDocs(prev => {
      const updated = prev.filter(c => c.name !== categoryName);
      try { localStorage.setItem('doctor_tools_categories_docs', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      const cat = categoriesDocs.find(c => c.name === categoryName);
      if (cat) {
        await deleteDoc(doc(db, 'users', uid, 'categories', cat.id));
      }
    }, `categories/${categoryName}`, OperationType.DELETE);
  }, [categoriesDocs, uid]);

  const addCustomer = useCallback(async (customer: Omit<Customer, 'id' | 'serialNumber'>): Promise<string> => {
    const serialNumber = `CUST-${1000 + customers.length + 1}`;
    const now = Date.now();
    const newRef = doc(collection(db, 'users', uid, 'customers'));
    const newId = newRef.id;

    const newCust: Customer = {
      ...customer,
      id: newId,
      serialNumber,
      createdAt: now,
      updatedAt: now
    };

    setCustomers(prev => {
      const updated = [newCust, ...prev.filter(c => c.id !== newId)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      try { localStorage.setItem('doctor_tools_customers', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      await setDoc(newRef, { ...customer, ownerId: uid, serialNumber, createdAt: now, updatedAt: now });
    }, `customers/${newId}`);

    return newId;
  }, [customers.length, uid]);

  const updateCustomer = useCallback(async (id: string, customer: Omit<Customer, 'id' | 'serialNumber'>) => {
    const now = Date.now();
    setCustomers(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, ...customer, updatedAt: now } : c);
      try { localStorage.setItem('doctor_tools_customers', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      await setDoc(doc(db, 'users', uid, 'customers', id), { ...customer, ownerId: uid, updatedAt: now }, { merge: true });
    }, `customers/${id}`);
  }, [uid]);

  const deleteCustomer = useCallback(async (id: string) => {
    setCustomers(prev => {
      const updated = prev.filter(c => c.id !== id);
      try { localStorage.setItem('doctor_tools_customers', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      await deleteDoc(doc(db, 'users', uid, 'customers', id));
    }, `customers/${id}`, OperationType.DELETE);
  }, [uid]);

  const addSupplier = useCallback(async (supplier: Omit<Supplier, 'id'>) => {
    const now = Date.now();
    const newRef = doc(collection(db, 'users', uid, 'suppliers'));
    const newId = newRef.id;

    const newSup: Supplier = {
      ...supplier,
      id: newId,
      createdAt: now,
      updatedAt: now
    };

    setSuppliers(prev => {
      const updated = [newSup, ...prev.filter(s => s.id !== newId)].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      try { localStorage.setItem('doctor_tools_suppliers', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      await setDoc(newRef, { ...supplier, ownerId: uid, createdAt: now, updatedAt: now });
    }, `suppliers/${newId}`);
  }, [uid]);

  const updateSupplier = useCallback(async (id: string, supplier: Omit<Supplier, 'id'>) => {
    const now = Date.now();
    setSuppliers(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, ...supplier, updatedAt: now } : s);
      try { localStorage.setItem('doctor_tools_suppliers', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      await setDoc(doc(db, 'users', uid, 'suppliers', id), { ...supplier, ownerId: uid, updatedAt: now }, { merge: true });
    }, `suppliers/${id}`);
  }, [uid]);

  const deleteSupplier = useCallback(async (id: string) => {
    setSuppliers(prev => {
      const updated = prev.filter(s => s.id !== id);
      try { localStorage.setItem('doctor_tools_suppliers', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      await deleteDoc(doc(db, 'users', uid, 'suppliers', id));
    }, `suppliers/${id}`, OperationType.DELETE);
  }, [uid]);

  const createInvoice = useCallback(async (invoice: Omit<Invoice, 'id' | 'invoiceNumber'>) => {
    const isQuote = invoice.isQuote || false;
    const invoiceNumber = isQuote 
      ? `QT-${1000 + invoices.filter(i => i.isQuote).length + 1}`
      : `INV-${1000 + invoices.length + 1}`;
    
    const newRef = doc(collection(db, 'users', uid, 'invoices'));
    const newId = newRef.id;

    const newInv: Invoice = {
      ...invoice,
      id: newId,
      invoiceNumber,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    setInvoices(prev => {
      const updated = [newInv, ...prev];
      try { localStorage.setItem('doctor_tools_invoices', JSON.stringify(updated)); } catch {}
      return updated;
    });

    if (!isQuote) {
      setInventory(prev => {
        const updated = prev.map(inv => {
          const sold = invoice.items.find(it => it.itemId === inv.id);
          if (sold) {
            return { ...inv, quantity: inv.quantity - sold.quantity, updatedAt: Date.now() };
          }
          return inv;
        });
        try { localStorage.setItem('doctor_tools_inventory', JSON.stringify(updated)); } catch {}
        return updated;
      });

      const remaining = invoice.total - invoice.paid;
      if (remaining !== 0 && invoice.customerId) {
        setCustomers(prev => {
          const updated = prev.map(c => {
            if (c.id === invoice.customerId) {
              return { ...c, balance: c.balance + remaining, updatedAt: Date.now() };
            }
            return c;
          });
          try { localStorage.setItem('doctor_tools_customers', JSON.stringify(updated)); } catch {}
          return updated;
        });
      }
    }

    safeFirestoreOperation(async () => {
      const batch = writeBatch(db);
      batch.set(newRef, { ...invoice, ownerId: uid, invoiceNumber, createdAt: Date.now(), updatedAt: Date.now() });
      
      if (!isQuote) {
        for (const item of invoice.items) {
          const invRef = doc(db, 'users', uid, 'inventory', item.itemId);
          const currentItem = inventory.find(i => i.id === item.itemId);
          if (currentItem) {
            batch.update(invRef, { quantity: currentItem.quantity - item.quantity, updatedAt: Date.now() });
          }
        }

        const remaining = invoice.total - invoice.paid;
        if (remaining !== 0 && invoice.customerId) {
          const custRef = doc(db, 'users', uid, 'customers', invoice.customerId);
          const currentCust = customers.find(c => c.id === invoice.customerId);
          if (currentCust) {
            batch.update(custRef, { balance: currentCust.balance + remaining, updatedAt: Date.now() });
          }
        }
      }
      
      await batch.commit();
    }, `invoices/${newId}`);
  }, [customers, inventory, invoices, uid]);

  const updateInvoice = useCallback(async (id: string, invoice: Omit<Invoice, 'id' | 'invoiceNumber'>) => {
    const existingInvoice = invoices.find(inv => inv.id === id);
    if (!existingInvoice) return;

    setInvoices(prev => {
      const updated = prev.map(inv => inv.id === id ? { ...inv, ...invoice, updatedAt: Date.now() } : inv);
      try { localStorage.setItem('doctor_tools_invoices', JSON.stringify(updated)); } catch {}
      return updated;
    });

    const wasQuote = existingInvoice.isQuote || false;
    const isQuote = invoice.isQuote || false;

    if (!wasQuote && !isQuote) {
      setInventory(prev => {
        const updated = prev.map(inv => {
          const oldItem = existingInvoice.items.find(it => it.itemId === inv.id);
          const newItem = invoice.items.find(it => it.itemId === inv.id);
          let qty = inv.quantity;
          if (oldItem) qty += oldItem.quantity;
          if (newItem) qty -= newItem.quantity;
          return qty !== inv.quantity ? { ...inv, quantity: qty, updatedAt: Date.now() } : inv;
        });
        try { localStorage.setItem('doctor_tools_inventory', JSON.stringify(updated)); } catch {}
        return updated;
      });

      const oldRemaining = existingInvoice.total - existingInvoice.paid;
      const newRemaining = invoice.total - invoice.paid;
      if (existingInvoice.customerId && invoice.customerId) {
        setCustomers(prev => {
          const updated = prev.map(c => {
            if (c.id === existingInvoice.customerId && existingInvoice.customerId === invoice.customerId) {
              return { ...c, balance: c.balance - oldRemaining + newRemaining, updatedAt: Date.now() };
            }
            if (c.id === existingInvoice.customerId) {
              return { ...c, balance: c.balance - oldRemaining, updatedAt: Date.now() };
            }
            if (c.id === invoice.customerId) {
              return { ...c, balance: c.balance + newRemaining, updatedAt: Date.now() };
            }
            return c;
          });
          try { localStorage.setItem('doctor_tools_customers', JSON.stringify(updated)); } catch {}
          return updated;
        });
      }
    }

    safeFirestoreOperation(async () => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', uid, 'invoices', id), { ...invoice, ownerId: uid, updatedAt: Date.now() }, { merge: true });

      if (!wasQuote && !isQuote) {
        for (const existingItem of existingInvoice.items) {
          const invRef = doc(db, 'users', uid, 'inventory', existingItem.itemId);
          const currentItem = inventory.find(i => i.id === existingItem.itemId);
          if (currentItem) {
            const newItem = invoice.items.find(i => i.itemId === existingItem.itemId);
            let newQuantity = currentItem.quantity + existingItem.quantity;
            if (newItem) newQuantity -= newItem.quantity;
            batch.update(invRef, { quantity: newQuantity, updatedAt: Date.now() });
          }
        }
        for (const newItem of invoice.items) {
          if (!existingInvoice.items.find(i => i.itemId === newItem.itemId)) {
            const invRef = doc(db, 'users', uid, 'inventory', newItem.itemId);
            const currentItem = inventory.find(i => i.id === newItem.itemId);
            if (currentItem) {
              batch.update(invRef, { quantity: currentItem.quantity - newItem.quantity, updatedAt: Date.now() });
            }
          }
        }

        const oldRemaining = existingInvoice.total - existingInvoice.paid;
        const newRemaining = invoice.total - invoice.paid;
        
        if (existingInvoice.customerId && invoice.customerId) {
          if (existingInvoice.customerId === invoice.customerId) {
              const custRef = doc(db, 'users', uid, 'customers', existingInvoice.customerId);
              const cust = customers.find(c => c.id === existingInvoice.customerId);
              if (cust) batch.update(custRef, { balance: cust.balance - oldRemaining + newRemaining, updatedAt: Date.now() });
          } else {
              const oldCustRef = doc(db, 'users', uid, 'customers', existingInvoice.customerId);
              const oldCust = customers.find(c => c.id === existingInvoice.customerId);
              if (oldCust) batch.update(oldCustRef, { balance: oldCust.balance - oldRemaining, updatedAt: Date.now() });

              const newCustRef = doc(db, 'users', uid, 'customers', invoice.customerId);
              const newCust = customers.find(c => c.id === invoice.customerId);
              if (newCust) batch.update(newCustRef, { balance: newCust.balance + newRemaining, updatedAt: Date.now() });
          }
        }
      }

      await batch.commit();
    }, `invoices/${id}`);
  }, [customers, inventory, invoices, uid]);

  const deleteInvoice = useCallback(async (id: string) => {
    const invToDelete = invoices.find(inv => inv.id === id);
    if (!invToDelete) return;

    setInvoices(prev => {
      const updated = prev.filter(inv => inv.id !== id);
      try { localStorage.setItem('doctor_tools_invoices', JSON.stringify(updated)); } catch {}
      return updated;
    });

    if (!invToDelete.isQuote) {
      setInventory(prev => {
        const updated = prev.map(inv => {
          const sold = invToDelete.items.find(it => it.itemId === inv.id);
          if (sold) {
            return { ...inv, quantity: inv.quantity + sold.quantity, updatedAt: Date.now() };
          }
          return inv;
        });
        try { localStorage.setItem('doctor_tools_inventory', JSON.stringify(updated)); } catch {}
        return updated;
      });

      const remaining = invToDelete.total - invToDelete.paid;
      if (remaining !== 0 && invToDelete.customerId) {
        setCustomers(prev => {
          const updated = prev.map(c => {
            if (c.id === invToDelete.customerId) {
              return { ...c, balance: c.balance - remaining, updatedAt: Date.now() };
            }
            return c;
          });
          try { localStorage.setItem('doctor_tools_customers', JSON.stringify(updated)); } catch {}
          return updated;
        });
      }
    }

    safeFirestoreOperation(async () => {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'users', uid, 'invoices', id));

      if (!invToDelete.isQuote) {
        for (const soldItem of invToDelete.items) {
          const invRef = doc(db, 'users', uid, 'inventory', soldItem.itemId);
          const currentItem = inventory.find(i => i.id === soldItem.itemId);
          if (currentItem) {
            batch.update(invRef, { quantity: currentItem.quantity + soldItem.quantity, updatedAt: Date.now() });
          }
        }

        const remaining = invToDelete.total - invToDelete.paid;
        if (remaining !== 0 && invToDelete.customerId) {
          const custRef = doc(db, 'users', uid, 'customers', invToDelete.customerId);
          const cust = customers.find(c => c.id === invToDelete.customerId);
          if (cust) batch.update(custRef, { balance: cust.balance - remaining, updatedAt: Date.now() });
        }
      }

      await batch.commit();
    }, `invoices/${id}`, OperationType.DELETE);
  }, [customers, inventory, invoices, uid]);

  const createPurchase = useCallback(async (purchase: Omit<PurchaseOrder, 'id'>) => {
    const newRef = doc(collection(db, 'users', uid, 'purchases'));
    const newId = newRef.id;

    const newPur: PurchaseOrder = {
      ...purchase,
      id: newId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    setPurchases(prev => {
      const updated = [newPur, ...prev];
      try { localStorage.setItem('doctor_tools_purchases', JSON.stringify(updated)); } catch {}
      return updated;
    });

    setInventory(prev => {
      const updated = prev.map(inv => {
        const purItem = purchase.items.find(it => it.itemId === inv.id);
        if (purItem) {
          return { ...inv, quantity: inv.quantity + purItem.quantity, purchasePrice: purItem.price, updatedAt: Date.now() };
        }
        return inv;
      });
      try { localStorage.setItem('doctor_tools_inventory', JSON.stringify(updated)); } catch {}
      return updated;
    });

    const remaining = purchase.total - purchase.paid;
    if (remaining !== 0) {
      setSuppliers(prev => {
        const updated = prev.map(s => {
          if (s.id === purchase.supplierId) {
            return { ...s, balance: s.balance + remaining, updatedAt: Date.now() };
          }
          return s;
        });
        try { localStorage.setItem('doctor_tools_suppliers', JSON.stringify(updated)); } catch {}
        return updated;
      });
    }

    safeFirestoreOperation(async () => {
      const batch = writeBatch(db);
      batch.set(newRef, { ...purchase, ownerId: uid, createdAt: Date.now(), updatedAt: Date.now() });
      
      for (const purItem of purchase.items) {
        const invRef = doc(db, 'users', uid, 'inventory', purItem.itemId);
        const currentItem = inventory.find(i => i.id === purItem.itemId);
        if (currentItem) {
          batch.update(invRef, { quantity: currentItem.quantity + purItem.quantity, purchasePrice: purItem.price, updatedAt: Date.now() });
        }
      }

      if (remaining !== 0) {
        const supRef = doc(db, 'users', uid, 'suppliers', purchase.supplierId);
        const sup = suppliers.find(s => s.id === purchase.supplierId);
        if (sup) {
          batch.update(supRef, { balance: sup.balance + remaining, updatedAt: Date.now() });
        }
      }
      
      await batch.commit();
    }, `purchases/${newId}`);
  }, [inventory, suppliers, uid]);

  const recordCustomerPayment = useCallback(async (customerId: string, amount: number) => {
    if (amount <= 0) return;
    const invoiceNumber = `PAY-${1000 + invoices.length + 1}`;
    const newRef = doc(collection(db, 'users', uid, 'invoices'));
    const newId = newRef.id;

    const newPayInv: Invoice = {
      id: newId,
      invoiceNumber,
      date: new Date().toISOString(),
      customerId,
      items: [],
      total: 0,
      paid: amount,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    setInvoices(prev => {
      const updated = [newPayInv, ...prev];
      try { localStorage.setItem('doctor_tools_invoices', JSON.stringify(updated)); } catch {}
      return updated;
    });
    setCustomers(prev => {
      const updated = prev.map(c => c.id === customerId ? { ...c, balance: c.balance - amount, updatedAt: Date.now() } : c);
      try { localStorage.setItem('doctor_tools_customers', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      const batch = writeBatch(db);
      batch.set(newRef, {
        ownerId: uid,
        invoiceNumber,
        date: new Date().toISOString(),
        customerId,
        items: [],
        total: 0,
        paid: amount,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      const custRef = doc(db, 'users', uid, 'customers', customerId);
      const cust = customers.find(c => c.id === customerId);
      if (cust) {
        batch.update(custRef, { balance: cust.balance - amount, updatedAt: Date.now() });
      }

      await batch.commit();
    }, `invoices/${newId}`);
  }, [customers, invoices.length, uid]);

  const recordSupplierPayment = useCallback(async (supplierId: string, amount: number) => {
    if (amount <= 0) return;
    const newRef = doc(collection(db, 'users', uid, 'purchases'));
    const newId = newRef.id;

    const newPayPur: PurchaseOrder = {
      id: newId,
      date: new Date().toISOString(),
      supplierId,
      items: [],
      total: 0,
      paid: amount,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    setPurchases(prev => {
      const updated = [newPayPur, ...prev];
      try { localStorage.setItem('doctor_tools_purchases', JSON.stringify(updated)); } catch {}
      return updated;
    });
    setSuppliers(prev => {
      const updated = prev.map(s => s.id === supplierId ? { ...s, balance: s.balance - amount, updatedAt: Date.now() } : s);
      try { localStorage.setItem('doctor_tools_suppliers', JSON.stringify(updated)); } catch {}
      return updated;
    });

    safeFirestoreOperation(async () => {
      const batch = writeBatch(db);
      batch.set(newRef, {
        ownerId: uid,
        date: new Date().toISOString(),
        supplierId,
        items: [],
        total: 0,
        paid: amount,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      const supRef = doc(db, 'users', uid, 'suppliers', supplierId);
      const sup = suppliers.find(s => s.id === supplierId);
      if (sup) {
        batch.update(supRef, { balance: sup.balance - amount, updatedAt: Date.now() });
      }

      await batch.commit();
    }, `purchases/${newId}`);
  }, [suppliers, uid]);

  const markAllNotificationsRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true, updatedAt: Date.now() })));

    await safeFirestoreOperation(async () => {
      const batch = writeBatch(db);
      let updated = 0;
      notifications.forEach(n => {
        if (!n.read && updated < 500) {
           batch.update(doc(db, 'users', uid, 'notifications', n.id), { read: true, updatedAt: Date.now() });
           updated++;
        }
      });
      if (updated > 0) await batch.commit();
    }, 'notifications');
  }, [notifications, uid]);

  const updateBusinessProfile = useCallback(async (profile: BusinessProfile) => {
    const dataToSave = {
      name: profile.name || 'Doctor Tools',
      phone: profile.phone || '01000000000',
      address: profile.address || 'القاهرة، مصر',
      description: profile.description || 'نظام إدارة العيادات والمستلزمات الطبية المتكامل',
      logo: profile.logo || null,
      ownerId: uid,
      createdAt: businessProfile.createdAt || profile.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    setBusinessProfile(dataToSave);

    await safeFirestoreOperation(async () => {
      await setDoc(doc(db, 'users', uid, 'profile', 'businessProfile'), dataToSave);
    }, 'profile/businessProfile');
  }, [businessProfile.createdAt, uid]);

  const exportFullBackup = useCallback(
    (options?: { includePassword?: boolean }): FullSystemBackup => {
      let currentTheme: 'light' | 'dark' | 'system' | undefined;
      let currentPassword: string | undefined;
      try {
        const savedTheme = localStorage.getItem('autoserv_theme');
        if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
          currentTheme = savedTheme;
        }
        if (options?.includePassword) {
          currentPassword = localStorage.getItem('autoserv_password') || 'admin';
        }
      } catch {}

      const backup = buildFullSystemBackup({
        businessProfile,
        categories,
        categoriesDocs,
        inventory,
        customers,
        suppliers,
        invoices,
        purchases,
        notifications,
        theme: currentTheme,
        authPassword: currentPassword,
      });

      try {
        localStorage.setItem('doctor_tools_last_backup_at', backup.exportedAt);
      } catch {}

      return backup;
    },
    [businessProfile, categories, categoriesDocs, inventory, customers, suppliers, invoices, purchases, notifications]
  );

  const restoreFullBackup = useCallback(
    async (
      backup: FullSystemBackup,
      mode: 'replace' | 'merge',
      options?: { restorePassword?: boolean }
    ): Promise<{
      success: boolean;
      cloudSynced: boolean;
      cloudError?: string;
      counts: BackupSummary;
    }> => {
      isRestoringRef.current = true;
      setSyncStatus('syncing');

      const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
        const map = new Map<string, T>();
        existing.forEach((item) => map.set(item.id, item));
        incoming.forEach((item) => map.set(item.id, item));
        return Array.from(map.values());
      };

      const incoming = backup.data;

      // Compute target datasets
      const finalCatsDocs = (() => {
        if (mode === 'replace') return incoming.categoriesDocs;
        const map = new Map<string, Category & { createdAt?: number; updatedAt?: number }>();
        categoriesDocs.forEach((c) => map.set(c.name, c));
        incoming.categoriesDocs.forEach((c) => {
          if (!map.has(c.name)) map.set(c.name, c);
        });
        return Array.from(map.values());
      })();
      const finalCategories = finalCatsDocs.map((c) => c.name);

      const finalInventory = (
        mode === 'replace' ? incoming.inventory : mergeById(inventory, incoming.inventory)
      ).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const finalCustomers = (
        mode === 'replace' ? incoming.customers : mergeById(customers, incoming.customers)
      ).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const finalSuppliers = (
        mode === 'replace' ? incoming.suppliers : mergeById(suppliers, incoming.suppliers)
      ).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const finalInvoices = (
        mode === 'replace' ? incoming.invoices : mergeById(invoices, incoming.invoices)
      ).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      const finalPurchases = (
        mode === 'replace' ? incoming.purchases : mergeById(purchases, incoming.purchases)
      ).sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      const finalNotifications =
        mode === 'replace'
          ? incoming.notifications
          : mergeById(
              notifications.filter((n) => !String(n.id || '').startsWith('low-stock-')),
              incoming.notifications
            );

      const finalProfile: BusinessProfile =
        mode === 'replace'
          ? incoming.businessProfile
          : {
              ...businessProfile,
              ...incoming.businessProfile,
              logo: incoming.businessProfile.logo ?? businessProfile.logo,
            };

      // 1. Apply to React state immediately
      setCategoriesDocs(finalCatsDocs);
      setCategories(finalCategories);
      setInventory(finalInventory);
      setCustomers(finalCustomers);
      setSuppliers(finalSuppliers);
      setInvoices(finalInvoices);
      setPurchases(finalPurchases);
      setNotifications(finalNotifications);
      setBusinessProfile(finalProfile);

      // 2. Persist immediately to localStorage
      try {
        localStorage.setItem('doctor_tools_categories_docs', JSON.stringify(finalCatsDocs));
        localStorage.setItem('doctor_tools_categories', JSON.stringify(finalCategories));
        localStorage.setItem('doctor_tools_inventory', JSON.stringify(finalInventory));
        localStorage.setItem('doctor_tools_customers', JSON.stringify(finalCustomers));
        localStorage.setItem('doctor_tools_suppliers', JSON.stringify(finalSuppliers));
        localStorage.setItem('doctor_tools_invoices', JSON.stringify(finalInvoices));
        localStorage.setItem('doctor_tools_purchases', JSON.stringify(finalPurchases));
        localStorage.setItem('doctor_tools_notifications', JSON.stringify(finalNotifications));
        localStorage.setItem('doctor_tools_profile', JSON.stringify(finalProfile));

        if (options?.restorePassword && backup.settings?.authPassword) {
          localStorage.setItem('autoserv_password', backup.settings.authPassword);
        }
      } catch (e) {
        console.warn('LocalStorage restore save warning:', e);
      }

      const counts: BackupSummary = {
        inventoryCount: finalInventory.length,
        categoriesCount: finalCategories.length,
        customersCount: finalCustomers.length,
        suppliersCount: finalSuppliers.length,
        invoicesCount: finalInvoices.length,
        purchasesCount: finalPurchases.length,
        notificationsCount: finalNotifications.length,
      };

      // 3. Persist to Firestore in safe chunked batches
      const commitOpsInChunks = async (ops: Array<(batch: WriteBatch) => void>) => {
        const CHUNK_SIZE = 400;
        for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
          const batch = writeBatch(db);
          const slice = ops.slice(i, i + CHUNK_SIZE);
          slice.forEach((fn) => fn(batch));
          await batch.commit();
        }
      };

      let cloudSynced = false;
      let cloudError: string | undefined;

      try {
        const now = Date.now();

        // Business profile (cannot delete per rules; preserve existing.createdAt on update)
        const profileRef = doc(db, 'users', uid, 'profile', 'businessProfile');
        const existingProfileSnap = await getDoc(profileRef);
        const profileCreatedAt = existingProfileSnap.exists()
          ? (existingProfileSnap.data().createdAt as number) || now
          : finalProfile.createdAt || now;
        await setDoc(profileRef, {
          ownerId: uid,
          name: finalProfile.name || 'Doctor Tools',
          phone: finalProfile.phone || '01000000000',
          address: finalProfile.address || 'القاهرة، مصر',
          description: finalProfile.description || '',
          logo: finalProfile.logo || null,
          createdAt: profileCreatedAt,
          updatedAt: now,
        });

        // Subcollections
        const subcollections: Array<{
          name: string;
          items: Array<{ id: string; data: Record<string, unknown> }>;
        }> = [
          {
            name: 'categories',
            items: finalCatsDocs.map((c) => {
              const catCreated = (c as Category & { createdAt?: number }).createdAt || now;
              return {
                id: c.id,
                data: {
                  ownerId: uid,
                  name: c.name,
                  createdAt: catCreated,
                  updatedAt: (c as Category & { updatedAt?: number }).updatedAt || now,
                },
              };
            }),
          },
          {
            name: 'inventory',
            items: finalInventory.map((item) => ({
              id: item.id,
              data: {
                ownerId: uid,
                code: item.code,
                name: item.name,
                brand: item.brand || '',
                compatibleCars: item.compatibleCars || '',
                category: item.category,
                storageLocation: item.storageLocation || '',
                quantity: item.quantity,
                purchasePrice: item.purchasePrice,
                sellPrice: item.sellPrice,
                createdAt: item.createdAt || now,
                updatedAt: item.updatedAt || now,
              },
            })),
          },
          {
            name: 'customers',
            items: finalCustomers.map((c) => ({
              id: c.id,
              data: {
                ownerId: uid,
                serialNumber: c.serialNumber,
                name: c.name,
                phone: c.phone || '',
                balance: c.balance,
                createdAt: c.createdAt || now,
                updatedAt: c.updatedAt || now,
              },
            })),
          },
          {
            name: 'suppliers',
            items: finalSuppliers.map((s) => ({
              id: s.id,
              data: {
                ownerId: uid,
                name: s.name,
                phone: s.phone || '',
                balance: s.balance,
                createdAt: s.createdAt || now,
                updatedAt: s.updatedAt || now,
              },
            })),
          },
          {
            name: 'invoices',
            items: finalInvoices.map((inv) => {
              const payload: Record<string, unknown> = {
                ownerId: uid,
                invoiceNumber: inv.invoiceNumber,
                date: inv.date,
                customerId: inv.customerId,
                items: inv.items,
                total: inv.total,
                paid: inv.paid,
                createdAt: inv.createdAt || now,
                updatedAt: inv.updatedAt || now,
              };
              if (inv.discountType) payload.discountType = inv.discountType;
              if (typeof inv.discountValue === 'number') payload.discountValue = inv.discountValue;
              if (typeof inv.isQuote === 'boolean') payload.isQuote = inv.isQuote;
              if (inv.customCustomerName) payload.customCustomerName = inv.customCustomerName;
              return { id: inv.id, data: payload };
            }),
          },
          {
            name: 'purchases',
            items: finalPurchases.map((p) => ({
              id: p.id,
              data: {
                ownerId: uid,
                date: p.date,
                supplierId: p.supplierId,
                items: p.items,
                total: p.total,
                paid: p.paid,
                createdAt: p.createdAt || now,
                updatedAt: p.updatedAt || now,
              },
            })),
          },
          {
            name: 'notifications',
            items: finalNotifications.map((n) => ({
              id: n.id,
              data: {
                ownerId: uid,
                message: n.message,
                date: n.date,
                read: Boolean(n.read),
                createdAt: n.createdAt || now,
                updatedAt: n.updatedAt || now,
              },
            })),
          },
        ];

        const deleteOps: Array<(batch: WriteBatch) => void> = [];
        const writeOps: Array<(batch: WriteBatch) => void> = [];

        for (const col of subcollections) {
          const snap = await getDocs(collection(db, 'users', uid, col.name));
          const existingCreatedAt = new Map<string, number>();
          snap.docs.forEach((d) => {
            const ca = d.data()?.createdAt;
            if (typeof ca === 'number') existingCreatedAt.set(d.id, ca);
            if (mode === 'replace') {
              deleteOps.push((batch) => batch.delete(d.ref));
            }
          });

          for (const item of col.items) {
            const ref = doc(db, 'users', uid, col.name, item.id);
            const preservedCreatedAt =
              mode === 'merge' && existingCreatedAt.has(item.id)
                ? existingCreatedAt.get(item.id)!
                : (item.data.createdAt as number);
            const payload = {
              ...item.data,
              createdAt: preservedCreatedAt,
            };
            writeOps.push((batch) => batch.set(ref, payload));
          }
        }

        if (deleteOps.length > 0) {
          await commitOpsInChunks(deleteOps);
        }
        if (writeOps.length > 0) {
          await commitOpsInChunks(writeOps);
        }

        cloudSynced = true;
        setSyncStatus('synced');
        setLastSyncTime(new Date());
      } catch (err) {
        cloudError = err instanceof Error ? err.message : String(err);
        console.warn('Firestore restore sync warning:', cloudError);
        setSyncStatus('error');
      } finally {
        isRestoringRef.current = false;
      }

      return {
        success: true,
        cloudSynced,
        cloudError,
        counts,
      };
    },
    [businessProfile, categoriesDocs, customers, inventory, invoices, notifications, purchases, suppliers, uid]
  );

  const contextValue = useMemo(() => ({
    inventory,
    categories,
    customers,
    suppliers,
    invoices,
    purchases,
    notifications: currentNotifications,
    businessProfile,
    syncStatus,
    isLiveSyncActive: true,
    lastSyncTime,
    syncNow,
    addInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    addCategory,
    removeCategory,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    createInvoice,
    updateInvoice,
    deleteInvoice,
    createPurchase,
    recordCustomerPayment,
    recordSupplierPayment,
    markAllNotificationsRead,
    updateBusinessProfile,
    exportFullBackup,
    restoreFullBackup
  }), [
    inventory,
    categories,
    customers,
    suppliers,
    invoices,
    purchases,
    currentNotifications,
    businessProfile,
    syncStatus,
    lastSyncTime,
    syncNow,
    addInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    addCategory,
    removeCategory,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    createInvoice,
    updateInvoice,
    deleteInvoice,
    createPurchase,
    recordCustomerPayment,
    recordSupplierPayment,
    markAllNotificationsRead,
    updateBusinessProfile,
    exportFullBackup,
    restoreFullBackup
  ]);

  return (
    <AppDataContext.Provider value={contextValue}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used within AppDataProvider');
  }
  return context;
}
