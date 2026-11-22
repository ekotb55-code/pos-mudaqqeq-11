import React from 'react';
import { PageType, UserAccount } from '../types';
import { hasPermission } from '../utils/permissions';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  ShoppingBag,
  Users,
  Wallet,
  Globe2,
  Receipt,
  RotateCcw,
  BarChart3,
  ShieldCheck,
  Shield,
  Settings,
  FileText,
  Truck,
  ArrowLeftRight,
  UserCheck,
  Percent,
  Sliders,
  Printer,
  Eye,
  Link,
  Layers,
  FileSpreadsheet,
  TrendingUp,
  CircleAlert,
  Archive,
  FolderTree,
  RefreshCw,
  Warehouse,
  ClipboardList,
  Keyboard,
  PackageX,
  Landmark,
  Building2,
  Palette
} from 'lucide-react';

export interface NavSubItem {
  id: string;
  page: PageType;
  tab?: string;
  path: string;
  labelAr: string;
  labelEn: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: (props: { lowStockCount: number }) => { text: string; color: string } | null;
  permission?: string | string[] | ((user: UserAccount | null) => boolean);
}

export interface NavGroup {
  id: string;
  labelAr: string;
  labelEn: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: (props: { lowStockCount: number }) => { text: string; color: string } | null;
  permission?: string | string[] | ((user: UserAccount | null) => boolean);
  subItems: NavSubItem[];
}

export interface NavGroupColorPalette {
  primary: string;
  dark: string;
  light: string;
}

/**
 * ألوان أقسام القائمة الجانبية (أساسي / غامق / فاتح) معرّفة في مكان واحد بمفتاح القسم
 */
export const NAV_GROUP_COLORS: Record<string, NavGroupColorPalette> = {
  dashboard: { primary: '#2563EB', dark: '#1D4ED8', light: '#DBEAFE' },
  sales: { primary: '#16A34A', dark: '#15803D', light: '#DCFCE7' },
  delivery: { primary: '#0F766E', dark: '#115E59', light: '#CCFBF1' },
  items: { primary: '#EA580C', dark: '#C2410C', light: '#FFEDD5' },
  warehouses: { primary: '#0284C7', dark: '#0369A1', light: '#E0F2FE' },
  purchases: { primary: '#7C3AED', dark: '#6D28D9', light: '#EDE9FE' },
  customers: { primary: '#0891B2', dark: '#0E7490', light: '#CFFAFE' },
  cashboxes: { primary: '#D97706', dark: '#B45309', light: '#FEF3C7' },
  platforms: { primary: '#DB2777', dark: '#BE185D', light: '#FCE7F3' },
  reports: { primary: '#4F46E5', dark: '#4338CA', light: '#E0E7FF' },
  permissions: { primary: '#E11D48', dark: '#BE123C', light: '#FFE4E6' },
  audit: { primary: '#0D9488', dark: '#0F766E', light: '#CCFBF1' },
  settings: { primary: '#475569', dark: '#334155', light: '#E2E8F0' }
};

export function getNavGroupColors(groupId: string): NavGroupColorPalette {
  return NAV_GROUP_COLORS[groupId] || NAV_GROUP_COLORS.settings;
}

/**
 * المصدر المركزي الموحد لتعريف مجموعات التنقل والصفحات الفرعية والمسارات المستقلة
 * يشمل اسم المجموعة، الصفحات الفرعية، المسار، والتبويب، والصلاحية المطلوبة
 */
export const NAV_GROUPS: NavGroup[] = [
  // 1. لوحة التحكم
  {
    id: 'dashboard',
    labelAr: 'لوحة التحكم',
    labelEn: 'Dashboard',
    icon: LayoutDashboard,
    permission: 'dashboard.view',
    subItems: [
      {
        id: 'dashboard-overview',
        page: 'dashboard',
        path: '/dashboard',
        labelAr: 'المؤشرات العامة والإحصائيات',
        labelEn: 'Overview & KPIs',
        icon: LayoutDashboard,
        permission: 'dashboard.view'
      }
    ]
  },

  // 2. المبيعات
  {
    id: 'sales',
    labelAr: 'المبيعات',
    labelEn: 'Sales',
    icon: ShoppingCart,
    permission: (user) =>
      user?.role === 'designer' ||
      Boolean(user?.isOwner) ||
      hasPermission(user, 'invoices.create') ||
      hasPermission(user, 'invoices.view') ||
      hasPermission(user, 'invoices.collect_credit') ||
      hasPermission(user, 'returns.view') ||
      hasPermission(user, 'offline.manage') ||
      hasPermission(user, 'visitor.display') ||
      hasPermission(user, 'settings.visitor_display'),
    subItems: [
      {
        id: 'pos-terminal',
        page: 'pos',
        path: '/pos',
        labelAr: 'نقطة بيع',
        labelEn: 'POS Terminal',
        icon: ShoppingCart,
        badge: () => ({ text: 'سريع', color: 'bg-[#1678C2]/40 text-[#42BDE5] border border-sky-400/40' }),
        permission: 'invoices.create'
      },
      {
        id: 'invoices-list',
        page: 'invoices',
        path: '/invoices',
        labelAr: 'سجل فواتير المبيعات',
        labelEn: 'Sales Invoices Log',
        icon: Receipt,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'invoices.view')
      },
      {
        id: 'credit-collection',
        page: 'credit_collection',
        path: '/credit-collection',
        labelAr: 'تحصيل الآجل',
        labelEn: 'Credit Collection',
        icon: Wallet,
        permission: (user) =>
          user?.role === 'designer' ||
          hasPermission(user, 'invoices.collect_credit') ||
          hasPermission(user, 'invoices.view')
      },
      {
        id: 'returns-list',
        page: 'returns',
        path: '/returns',
        labelAr: 'سجل مرتجعات المبيعات',
        labelEn: 'Sales Returns Log',
        icon: RotateCcw,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'returns.view')
      },
      {
        id: 'sync-pending',
        page: 'sync',
        tab: 'pending',
        path: '/sync/pending',
        labelAr: 'المزامنة — العمليات المعلّقة',
        labelEn: 'Sync — Pending Operations',
        icon: RefreshCw,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'offline.manage')
      },
      {
        id: 'sync-failed',
        page: 'sync',
        tab: 'failed',
        path: '/sync/failed',
        labelAr: 'المزامنة — العمليات الفاشلة',
        labelEn: 'Sync — Failed Operations',
        icon: CircleAlert,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'offline.manage')
      },
      {
        id: 'sync-needs-review',
        page: 'sync',
        tab: 'needs_review',
        path: '/sync/needs-review',
        labelAr: 'المزامنة — فواتير تحتاج مراجعة',
        labelEn: 'Sync — Needs Review',
        icon: ClipboardList,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'offline.manage')
      },
      {
        id: 'sales-visitor-display',
        page: 'visitor',
        path: '/visitor',
        labelAr: 'شاشة الزوار',
        labelEn: 'Visitor Display',
        icon: Eye,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'visitor.display') ||
          hasPermission(user, 'settings.visitor_display')
      }
    ]
  },

  // التوصيل
  {
    id: 'delivery',
    labelAr: 'التوصيل',
    labelEn: 'Delivery',
    icon: Truck,
    permission: (user) =>
      user?.role === 'designer' ||
      Boolean(user?.isOwner) ||
      hasPermission(user, 'delivery.driver') ||
      hasPermission(user, 'delivery.view') ||
      hasPermission(user, 'delivery.settle') ||
      hasPermission(user, 'delivery.reports') ||
      hasPermission(user, 'delivery.settings'),
    subItems: [
      {
        id: 'delivery-my-orders',
        page: 'delivery_my_orders',
        path: '/delivery/my-orders',
        labelAr: 'طلباتي',
        labelEn: 'My Delivery Orders',
        icon: Truck,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'delivery.driver')
      },
      {
        id: 'delivery-orders',
        page: 'delivery_orders',
        path: '/delivery/orders',
        labelAr: 'إدارة طلبات التوصيل',
        labelEn: 'Delivery Orders',
        icon: ClipboardList,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'delivery.view')
      },
      {
        id: 'delivery-settlements',
        page: 'delivery_settlements',
        path: '/delivery/settlements',
        labelAr: 'التسويات ومستحقات الطيارين',
        labelEn: 'Delivery Settlements & Payouts',
        icon: Wallet,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'delivery.settle')
      },
      {
        id: 'delivery-reports',
        page: 'delivery_reports',
        path: '/delivery/reports',
        labelAr: 'تقارير التوصيل',
        labelEn: 'Delivery Reports',
        icon: BarChart3,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'delivery.reports')
      },
      {
        id: 'delivery-settings',
        page: 'delivery_settings',
        path: '/delivery/settings',
        labelAr: 'إعدادات التوصيل',
        labelEn: 'Delivery Settings',
        icon: Settings,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'delivery.settings')
      }
    ]
  },

  // 3. الأصناف والمخزون
  {
    id: 'items',
    labelAr: 'الأصناف والمخزون',
    labelEn: 'Items & Inventory',
    icon: Package,
    badge: ({ lowStockCount }) =>
      lowStockCount > 0 ? { text: String(lowStockCount), color: 'bg-rose-500 text-white' } : null,
    permission: (user) =>
      user?.role === 'designer' ||
      Boolean(user?.isOwner) ||
      hasPermission(user, 'items.view') ||
      hasPermission(user, 'categories.view') ||
      hasPermission(user, 'products.bulk_edit_excel') ||
      hasPermission(user, 'items.print_labels'),
    subItems: [
      {
        id: 'items-list',
        page: 'items',
        tab: 'ALL',
        path: '/items',
        labelAr: 'دليل الأصناف والمخزون',
        labelEn: 'Items & Inventory List',
        icon: Package,
        permission: 'items.view'
      },
      {
        id: 'items-categories',
        page: 'categories',
        path: '/items/categories',
        labelAr: 'التصنيفات',
        labelEn: 'Categories',
        icon: FolderTree,
        permission: 'categories.view'
      },
      {
        id: 'items-low-stock',
        page: 'items',
        tab: 'LOW_STOCK',
        path: '/items/low-stock',
        labelAr: 'نواقص المخزون والحد الأدنى',
        labelEn: 'Low Stock Alerts',
        icon: CircleAlert,
        badge: ({ lowStockCount }) =>
          lowStockCount > 0 ? { text: String(lowStockCount), color: 'bg-amber-500 text-white' } : null,
        permission: 'items.view'
      },
      {
        id: 'items-out-of-stock',
        page: 'items',
        tab: 'OUT_OF_STOCK',
        path: '/items/out-of-stock',
        labelAr: 'أصناف نفدت كميتها',
        labelEn: 'Out of Stock Items',
        icon: CircleAlert,
        permission: 'items.view'
      },
      {
        id: 'items-archived',
        page: 'items',
        tab: 'ARCHIVED',
        path: '/items/archived',
        labelAr: 'الأصناف المؤرشفة',
        labelEn: 'Archived Items',
        icon: Archive,
        permission: 'items.view'
      },
      {
        id: 'items-bulk-edit-excel',
        page: 'bulk_edit_excel',
        path: '/items/bulk-edit',
        labelAr: 'تعديل بالإكسيل',
        labelEn: 'Bulk Edit Excel',
        icon: FileSpreadsheet,
        permission: 'products.bulk_edit_excel'
      },
      {
        id: 'items-label-print',
        page: 'label_print',
        path: '/items/labels',
        labelAr: 'طباعة التكت',
        labelEn: 'Label Printing',
        icon: Printer,
        permission: 'items.print_labels'
      }
    ]
  },

  // 3b. المخازن
  {
    id: 'warehouses',
    labelAr: 'المخازن',
    labelEn: 'Warehouses',
    icon: Warehouse,
    permission: (user) =>
      user?.role === 'designer' ||
      Boolean(user?.isOwner) ||
      hasPermission(user, 'warehouses.view') ||
      hasPermission(user, 'warehouses.manage') ||
      hasPermission(user, 'warehouses.transfer'),
    subItems: [
      {
        id: 'warehouses-list',
        page: 'warehouses',
        path: '/warehouses',
        labelAr: 'المخازن',
        labelEn: 'Warehouses',
        icon: Warehouse,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'warehouses.view') ||
          hasPermission(user, 'warehouses.manage')
      },
      {
        id: 'warehouse-transfers',
        page: 'warehouse_transfers',
        path: '/warehouses/transfers',
        labelAr: 'تحويل بين المخازن',
        labelEn: 'Warehouse Transfers',
        icon: ArrowLeftRight,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'warehouses.transfer')
      },
      {
        id: 'warehouse-excel-transfer',
        page: 'warehouse_excel_transfer',
        path: '/warehouses/excel-transfer',
        labelAr: 'نقل بالإكسيل بين المخازن',
        labelEn: 'Excel Warehouse Transfer',
        icon: FileSpreadsheet,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'warehouses.transfer')
      },
      {
        id: 'warehouse-dispatch-orders',
        page: 'warehouse_dispatch_orders',
        path: '/warehouses/dispatch-orders',
        labelAr: 'عرض أوامر الصرف',
        labelEn: 'Dispatch Orders',
        icon: ClipboardList,
        permission: (user) =>
          user?.role === 'designer' ||
          Boolean(user?.isOwner) ||
          hasPermission(user, 'warehouses.view') ||
          hasPermission(user, 'warehouses.transfer')
      }
    ]
  },

  // 4. المشتريات والموردون
  {
    id: 'purchases',
    labelAr: 'المشتريات والموردون',
    labelEn: 'Purchases & Suppliers',
    icon: ShoppingBag,
    permission: (user) =>
      user?.role === 'designer' ||
      Boolean(user?.isOwner) ||
      hasPermission(user, 'purchases.view') ||
      hasPermission(user, 'suppliers.view') ||
      hasPermission(user, 'cashbox.payment') ||
      hasPermission(user, 'cashbox.receipt'),
    subItems: [
      {
        id: 'purchases-invoices',
        page: 'purchases',
        tab: 'PURCHASES',
        path: '/purchases/invoices',
        labelAr: 'فواتير الشراء',
        labelEn: 'Purchase Invoices',
        icon: FileText,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'purchases.view')
      },
      {
        id: 'purchases-today',
        page: 'purchases',
        tab: 'TODAY',
        path: '/purchases/today',
        labelAr: 'مشتريات اليوم',
        labelEn: "Today's Purchases",
        icon: Receipt,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'purchases.view')
      },
      {
        id: 'purchases-returns',
        page: 'purchases',
        tab: 'RETURN',
        path: '/purchases/returns',
        labelAr: 'مرتجع المشتريات',
        labelEn: 'Purchase Returns',
        icon: RotateCcw,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'purchases.view')
      },
      {
        id: 'purchases-suppliers',
        page: 'purchases',
        tab: 'SUPPLIERS',
        path: '/purchases/suppliers',
        labelAr: 'الموردين',
        labelEn: 'Suppliers',
        icon: Users,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'suppliers.view')
      },
      {
        id: 'purchases-groups',
        page: 'purchases',
        tab: 'GROUPS',
        path: '/purchases/groups',
        labelAr: 'مجموعات الموردين',
        labelEn: 'Supplier Groups',
        icon: Layers,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'suppliers.view')
      },
      {
        id: 'purchases-balances',
        page: 'purchases',
        tab: 'BALANCES',
        path: '/purchases/balances',
        labelAr: 'كشف مديونية الموردين',
        labelEn: 'Supplier Balances',
        icon: Wallet,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'suppliers.view')
      },
      {
        id: 'purchases-statement',
        page: 'purchases',
        tab: 'STATEMENT',
        path: '/purchases/statement',
        labelAr: 'كشف حساب المورد',
        labelEn: 'Supplier Statement',
        icon: FileSpreadsheet,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'suppliers.view')
      },
      {
        id: 'purchases-payment-voucher',
        page: 'purchases',
        tab: 'PAYMENT_VOUCHER',
        path: '/purchases/payment-voucher',
        labelAr: 'سند صرف لمورد',
        labelEn: 'Supplier Payment Voucher',
        icon: ArrowLeftRight,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'cashbox.payment')
      },
      {
        id: 'purchases-receipt-voucher',
        page: 'purchases',
        tab: 'RECEIPT_VOUCHER',
        path: '/purchases/receipt-voucher',
        labelAr: 'سند قبض من مورد',
        labelEn: 'Supplier Receipt Voucher',
        icon: ArrowLeftRight,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'cashbox.receipt')
      }
    ]
  },

  // 5. العملاء والحسابات
  {
    id: 'customers',
    labelAr: 'العملاء والحسابات',
    labelEn: 'Customers & Accounts',
    icon: Users,
    permission: (user) =>
      user?.role === 'designer' ||
      Boolean(user?.isOwner) ||
      hasPermission(user, 'customers.view') ||
      hasPermission(user, 'invoices.collect_credit') ||
      hasPermission(user, 'cashbox.receipt') ||
      hasPermission(user, 'cashbox.payment'),
    subItems: [
      {
        id: 'customers-list',
        page: 'customers',
        tab: 'CUSTOMERS',
        path: '/customers/list',
        labelAr: 'دليل العملاء',
        labelEn: 'Customers Directory',
        icon: Users,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'customers.view')
      },
      {
        id: 'customers-groups',
        page: 'customers',
        tab: 'GROUPS',
        path: '/customers/groups',
        labelAr: 'المجموعات',
        labelEn: 'Customer Groups',
        icon: Layers,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'customers.view')
      },
      {
        id: 'customers-balances',
        page: 'customers',
        tab: 'BALANCES',
        path: '/customers/balances',
        labelAr: 'كشف المديونية',
        labelEn: 'Customer Balances',
        icon: Wallet,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'customers.view')
      },
      {
        id: 'customers-statement',
        page: 'customers',
        tab: 'STATEMENT',
        path: '/customers/statement',
        labelAr: 'كشف حساب العميل',
        labelEn: 'Customer Statement',
        icon: FileSpreadsheet,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'customers.view')
      },
      {
        id: 'customers-credit-collection',
        page: 'customers',
        tab: 'CREDIT_COLLECTION',
        path: '/customers/credit-collection',
        labelAr: 'تحصيل الآجل',
        labelEn: 'Credit Collection',
        icon: Wallet,
        permission: (user) =>
          user?.role === 'designer' ||
          hasPermission(user, 'invoices.collect_credit') ||
          hasPermission(user, 'invoices.view')
      },
      {
        id: 'customers-receipt-voucher',
        page: 'customers',
        tab: 'RECEIPT_VOUCHER',
        path: '/customers/receipt-voucher',
        labelAr: 'سند قبض من عميل',
        labelEn: 'Customer Receipt Voucher',
        icon: ArrowLeftRight,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'cashbox.receipt')
      },
      {
        id: 'customers-payment-voucher',
        page: 'customers',
        tab: 'PAYMENT_VOUCHER',
        path: '/customers/payment-voucher',
        labelAr: 'سند صرف لعميل',
        labelEn: 'Customer Payment Voucher',
        icon: ArrowLeftRight,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'cashbox.payment')
      }
    ]
  },

  // 6. الخزائن والحركات النقدية
  {
    id: 'cashboxes',
    labelAr: 'الخزائن والحركات النقدية',
    labelEn: 'Cashboxes & Transactions',
    icon: Wallet,
    permission: (user) =>
      user?.role === 'designer' ||
      Boolean(user?.isOwner) ||
      hasPermission(user, 'cashbox.view') ||
      hasPermission(user, 'cashbox.transfer') ||
      hasPermission(user, 'permissions.manage'),
    subItems: [
      {
        id: 'cashboxes-balances',
        page: 'cashboxes',
        tab: 'CASHBOXES',
        path: '/cashboxes/balances',
        labelAr: 'الخزائن والحسابات',
        labelEn: 'Cashboxes & Balances',
        icon: Wallet,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'cashbox.view')
      },
      {
        id: 'cashboxes-transactions',
        page: 'cashboxes',
        tab: 'TRANSACTIONS',
        path: '/cashboxes/transactions',
        labelAr: 'سجل الحركات النقدية',
        labelEn: 'Cash Transactions Log',
        icon: FileText,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'cashbox.view')
      },
      {
        id: 'cashboxes-transfer',
        page: 'cashboxes',
        tab: 'TRANSFER',
        path: '/cashboxes/transfer',
        labelAr: 'تحويل بين الخزائن',
        labelEn: 'Cash Transfers',
        icon: ArrowLeftRight,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'cashbox.transfer')
      },
      {
        id: 'cashboxes-assignments',
        page: 'cashboxes',
        tab: 'ASSIGNMENTS',
        path: '/cashboxes/assignments',
        labelAr: 'تعيينات المستخدمين',
        labelEn: 'User Cashbox Assignments',
        icon: UserCheck,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'permissions.manage')
      }
    ]
  },

  // 7. المنصات وتكاليف الشحن
  {
    id: 'platforms',
    labelAr: 'المنصات وتكاليف الشحن',
    labelEn: 'Platforms & Shipping Costs',
    icon: Globe2,
    permission: (user) =>
      user?.role === 'designer' ||
      Boolean(user?.isOwner) ||
      hasPermission(user, 'platforms.view') ||
      hasPermission(user, 'platforms.pricing') ||
      hasPermission(user, 'reports.platform_view') ||
      hasPermission(user, 'invoices.collect_credit'),
    subItems: [
      {
        id: 'platforms-list',
        page: 'platforms',
        tab: 'platforms',
        path: '/platforms/list',
        labelAr: 'المنصات',
        labelEn: 'Marketplace Platforms',
        icon: Globe2,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'platforms.view')
      },
      {
        id: 'platforms-credit-collection',
        page: 'platforms',
        tab: 'creditCollection',
        path: '/platforms/credit-collection',
        labelAr: 'تحصيل الآجل',
        labelEn: 'Platform Credit Collection',
        icon: Wallet,
        permission: (user) =>
          user?.role === 'designer' ||
          hasPermission(user, 'invoices.collect_credit') ||
          hasPermission(user, 'invoices.view')
      },
      {
        id: 'platforms-report',
        page: 'platforms',
        tab: 'platformReport',
        path: '/platforms/report',
        labelAr: 'تقرير المنصة',
        labelEn: 'Platform Report',
        icon: BarChart3,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.platform_view')
      },
      {
        id: 'platforms-shipping',
        page: 'platforms',
        tab: 'shippingCosts',
        path: '/platforms/shipping-costs',
        labelAr: 'استقطاعات شحن المرتجع',
        labelEn: 'Platform Return Shipping Costs',
        icon: Truck,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'platforms.pricing')
      }
    ]
  },

  // 8. التقارير وصافي الأرباح
  {
    id: 'reports',
    labelAr: 'التقارير وصافي الأرباح',
    labelEn: 'Reports & Net Profit',
    icon: BarChart3,
    permission: (user) =>
      user?.role === 'designer' ||
      Boolean(user?.isOwner) ||
      hasPermission(user, 'reports.view_reports') ||
      hasPermission(user, 'reports.item_movement.view') ||
      hasPermission(user, 'reports.stock_adjustments.view') ||
      hasPermission(user, 'reports.bnpl_view') ||
      hasPermission(user, 'reports.unsold_cart_items.view'),
    subItems: [
      {
        id: 'reports-financial',
        page: 'reports',
        tab: 'FINANCIAL',
        path: '/reports/financial',
        labelAr: 'التقرير المالي وصافي الأرباح',
        labelEn: 'Financial & Profit Report',
        icon: TrendingUp,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.view_reports')
      },
      {
        id: 'reports-sales-purchases',
        page: 'reports',
        tab: 'SALES_PURCHASES',
        path: '/reports/sales-purchases',
        labelAr: 'تقرير المبيعات والمشتريات',
        labelEn: 'Sales vs Purchases',
        icon: BarChart3,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.view_reports')
      },
      {
        id: 'reports-cash-flow',
        page: 'reports',
        tab: 'CASH_FLOW',
        path: '/reports/cash-flow',
        labelAr: 'تقرير التدفق النقدي والخزائن',
        labelEn: 'Cash Flow Report',
        icon: Wallet,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.view_reports')
      },
      {
        id: 'reports-balances',
        page: 'reports',
        tab: 'BALANCES',
        path: '/reports/balances',
        labelAr: 'مديونية الموردين والعملاء',
        labelEn: 'Suppliers & Customers Balances',
        icon: Users,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.view_reports')
      },
      {
        id: 'reports-low-stock',
        page: 'reports',
        tab: 'LOW_STOCK',
        path: '/reports/low-stock',
        labelAr: 'تنبيهات نواقص المخزون',
        labelEn: 'Low Stock Alerts',
        icon: CircleAlert,
        badge: ({ lowStockCount }) =>
          lowStockCount > 0 ? { text: String(lowStockCount), color: 'bg-rose-500 text-white' } : null,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.view_reports')
      },
      {
        id: 'reports-item-movement',
        page: 'reports',
        tab: 'ITEM_MOVEMENT',
        path: '/reports/item-movement',
        labelAr: 'حركة الصنف التفصيلية',
        labelEn: 'Item Movement Report',
        icon: ArrowLeftRight,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.item_movement.view')
      },
      {
        id: 'reports-stock-adjustments',
        page: 'reports',
        tab: 'STOCK_ADJUSTMENTS',
        path: '/reports/stock-adjustments',
        labelAr: 'تسويات المخزون',
        labelEn: 'Stock Adjustments Report',
        icon: ClipboardList,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.stock_adjustments.view')
      },
      {
        id: 'reports-reconciliation',
        page: 'reports',
        tab: 'RECONCILIATION',
        path: '/reports/reconciliation',
        labelAr: 'المطابقة والترحيل المحاسبي',
        labelEn: 'Accounting Reconciliation',
        icon: FileSpreadsheet,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.view_reports')
      },
      {
        id: 'reports-bnpl',
        page: 'reports',
        tab: 'BNPL',
        path: '/reports/bnpl',
        labelAr: 'تقرير تقسيط المنصات (BNPL)',
        labelEn: 'BNPL Platforms Report',
        icon: Percent,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'reports.bnpl_view')
      },
      {
        id: 'reports-unsold-cart-items',
        page: 'reports',
        tab: 'UNSOLD_CART_ITEMS',
        path: '/reports/unsold-cart-items',
        labelAr: 'أصناف لم تُبع من شاشة البيع',
        labelEn: 'Unsold POS Cart Items',
        icon: PackageX,
        permission: (user) =>
          user?.role === 'designer' || hasPermission(user, 'reports.unsold_cart_items.view')
      }
    ]
  },

  // 10. مصفوفة الصلاحيات
  {
    id: 'permissions',
    labelAr: 'مصفوفة الصلاحيات',
    labelEn: 'Permissions Matrix',
    icon: ShieldCheck,
    badge: () => ({ text: 'RBAC', color: 'bg-emerald-950 text-emerald-300 border border-emerald-700' }),
    permission: (user) =>
      user?.role === 'designer' ||
      hasPermission(user, 'permissions.view') ||
      hasPermission(user, 'permissions.manage') ||
      hasPermission(user, 'users.view'),
    subItems: [
      {
        id: 'permissions-matrix',
        page: 'permissions',
        path: '/permissions',
        labelAr: 'مصفوفة الصلاحيات (RBAC)',
        labelEn: 'Permissions Matrix',
        icon: ShieldCheck,
        permission: (user) =>
          user?.role === 'designer' ||
          hasPermission(user, 'permissions.view') ||
          hasPermission(user, 'permissions.manage')
      },
      {
        id: 'permissions-users',
        page: 'settings',
        tab: 'users',
        path: '/settings/users',
        labelAr: 'إدارة المستخدمين',
        labelEn: 'User Accounts',
        icon: Users,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'users.view')
      }
    ]
  },

  // 11. سجل التدقيق
  {
    id: 'audit',
    labelAr: 'سجل التدقيق',
    labelEn: 'Audit Log',
    icon: Shield,
    permission: (user) => user?.role === 'designer' || hasPermission(user, 'audit.view'),
    subItems: [
      {
        id: 'audit-log-view',
        page: 'audit',
        path: '/audit',
        labelAr: 'سجل التدقيق الزمني الشامل',
        labelEn: 'Audit Logs Timeline',
        icon: Shield,
        permission: (user) => user?.role === 'designer' || hasPermission(user, 'audit.view')
      }
    ]
  },

  // 12. إعدادات النظام (عنصر رئيسي مباشر بدون قوائم فرعية في القائمة الرئيسية)
  {
    id: 'settings',
    labelAr: 'إعدادات النظام',
    labelEn: 'System Settings',
    icon: Settings,
    permission: hasAnySettingsPermission,
    subItems: [
      {
        id: 'settings-main',
        page: 'settings',
        path: '/settings',
        labelAr: 'إعدادات النظام',
        labelEn: 'System Settings',
        icon: Settings,
        permission: hasAnySettingsPermission
      }
    ]
  }
];

function hasAnySettingsPermission(user: UserAccount | null): boolean {
  return (
    user?.role === 'designer' ||
    hasPermission(user, 'settings.company_appearance') ||
    hasPermission(user, 'settings.invoice_print') ||
    hasPermission(user, 'settings.display_customization') ||
    hasPermission(user, 'settings.sales_rules') ||
    hasPermission(user, 'settings.ui_scale') ||
    hasPermission(user, 'settings.system_integration') ||
    hasPermission(user, 'settings.backup') ||
    hasPermission(user, 'settings.bank_link') ||
    hasPermission(user, 'settings.bank_templates') ||
    hasPermission(user, 'settings.reset_operations') ||
    hasPermission(user, 'settings.factory_reset') ||
    hasPermission(user, 'settings.negative_stock') ||
    hasPermission(user, 'settings.visitor_display') ||
    hasPermission(user, 'settings.label_print') ||
    hasPermission(user, 'settings.invoice_numbering')
  );
}

/**
 * المسارات المباشرة لأقسام إعدادات النظام: لا تُعرض كقوائم فرعية في القائمة الرئيسية،
 * لكنها محفوظة لدعم الروابط المباشرة والقديمة والتنقل الداخلي من بقية الصفحات بنفس الصلاحيات.
 */
export const SETTINGS_DIRECT_ROUTES: NavSubItem[] = [
  {
    id: 'settings-company',
    page: 'settings',
    tab: 'company',
    path: '/settings/company',
    labelAr: 'بيانات المنشأة',
    labelEn: 'Establishment Info',
    icon: Building2,
    permission: (user) => user?.role === 'designer' || hasPermission(user, 'settings.company_appearance')
  },
  {
    id: 'settings-appearance',
    page: 'settings',
    tab: 'appearance',
    path: '/settings/appearance',
    labelAr: 'المظهر والحجم',
    labelEn: 'Appearance & Scale',
    icon: Palette,
    permission: (user) =>
      user?.role === 'designer' ||
      hasPermission(user, 'settings.company_appearance') ||
      hasPermission(user, 'settings.ui_scale') ||
      hasPermission(user, 'settings.display_customization')
  },
  {
    id: 'settings-sales',
    page: 'settings',
    tab: 'sales',
    path: '/settings/sales',
    labelAr: 'البيع ونقطة البيع',
    labelEn: 'Sales & POS',
    icon: ShoppingCart,
    permission: (user) =>
      user?.role === 'designer' ||
      hasPermission(user, 'settings.sales_rules') ||
      hasPermission(user, 'settings.display_customization') ||
      hasPermission(user, 'settings.company_appearance')
  },
  {
    id: 'settings-visitor',
    page: 'settings',
    tab: 'visitor',
    path: '/settings/visitor',
    labelAr: 'شاشة الزوار',
    labelEn: 'Visitor Display',
    icon: Eye,
    permission: (user) =>
      user?.role === 'designer' || hasPermission(user, 'settings.visitor_display')
  },
  {
    id: 'settings-stock',
    page: 'settings',
    tab: 'stock',
    path: '/settings/stock',
    labelAr: 'الأصناف والمخزون',
    labelEn: 'Items & Inventory',
    icon: Package,
    permission: (user) =>
      user?.role === 'designer' ||
      hasPermission(user, 'settings.negative_stock') ||
      hasPermission(user, 'settings.display_customization')
  },
  {
    id: 'settings-print',
    page: 'settings',
    tab: 'print',
    path: '/settings/print',
    labelAr: 'الفواتير والطباعة',
    labelEn: 'Invoice & Print Settings',
    icon: Printer,
    permission: (user) =>
      user?.role === 'designer' ||
      hasPermission(user, 'settings.invoice_print') ||
      hasPermission(user, 'settings.invoice_numbering')
  },
  {
    id: 'settings-labels',
    page: 'settings',
    tab: 'labels',
    path: '/settings/labels',
    labelAr: 'طابعة الباركود',
    labelEn: 'Barcode Label Printer',
    icon: Printer,
    permission: (user) => user?.role === 'designer' || hasPermission(user, 'settings.label_print')
  },
  {
    id: 'settings-tax',
    page: 'settings',
    tab: 'tax',
    path: '/settings/tax',
    labelAr: 'الضريبة والعمولة',
    labelEn: 'Tax & Commissions',
    icon: Percent,
    permission: (user) => user?.role === 'designer' || hasPermission(user, 'settings.company_appearance')
  },
  {
    id: 'settings-bank-link',
    page: 'settings',
    tab: 'bank_link',
    path: '/settings/bank-link',
    labelAr: 'الخزن المربوطة بالبنك',
    labelEn: 'Bank-Linked Cashboxes',
    icon: Landmark,
    permission: (user) =>
      user?.role === 'designer' ||
      hasPermission(user, 'settings.bank_link')
  },
  {
    id: 'settings-integration',
    page: 'settings',
    tab: 'integration',
    path: '/settings/integration',
    labelAr: 'قاعدة البيانات والنسخ الاحتياطي',
    labelEn: 'Database & Backup',
    icon: Link,
    permission: (user) =>
      user?.role === 'designer' ||
      hasPermission(user, 'settings.system_integration') ||
      hasPermission(user, 'settings.backup') ||
      hasPermission(user, 'settings.reset_operations') ||
      hasPermission(user, 'settings.factory_reset')
  },
  {
    id: 'settings-shortcuts',
    page: 'settings',
    tab: 'shortcuts',
    path: '/settings/shortcuts',
    labelAr: 'اختصارات لوحة المفاتيح',
    labelEn: 'Keyboard Shortcuts',
    icon: Keyboard,
    permission: (user) =>
      user?.role === 'designer' ||
      hasPermission(user, 'settings.company_appearance') ||
      hasPermission(user, 'settings.display_customization') ||
      hasPermission(user, 'settings.sales_rules') ||
      hasPermission(user, 'settings.invoice_print') ||
      hasPermission(user, 'settings.system_integration') ||
      hasPermission(user, 'settings.backup') ||
      hasPermission(user, 'settings.negative_stock') ||
      hasPermission(user, 'settings.visitor_display') ||
      hasPermission(user, 'settings.label_print') ||
      hasPermission(user, 'settings.invoice_numbering')
  }
];

export const ALL_NAV_SUB_ITEMS: NavSubItem[] = NAV_GROUPS.flatMap((g) => g.subItems);
const ALL_ROUTE_SUB_ITEMS: NavSubItem[] = [...ALL_NAV_SUB_ITEMS, ...SETTINGS_DIRECT_ROUTES];

/**
 * تحويل المسارات القديمة أو المختصرة إلى الصفحة المقابلة ليتم اختيار أول مسار فرعي متاح لصلاحيات المستخدم
 */
export const LEGACY_PAGE_REDIRECTS: Record<string, { page: PageType; tab?: string; hash?: string }> = {
  '/': { page: 'dashboard' },
  '/settings': { page: 'settings' },
  '/settings/backup': { page: 'settings', tab: 'integration', hash: '#backup' },
  '/settings/display': { page: 'settings', tab: 'sales' },
  '/settings/ui-scale': { page: 'settings', tab: 'appearance' },
  '/reports': { page: 'reports' },
  '/customers': { page: 'customers' },
  '/cashboxes': { page: 'cashboxes' },
  '/platforms': { page: 'platforms' },
  '/purchases': { page: 'purchases' },
  '/sync': { page: 'sync' },
  '/bulk-edit-excel': { page: 'bulk_edit_excel' },
  '/items/import': { page: 'bulk_edit_excel', tab: 'add_items' },
  '/categories': { page: 'categories' }
};

export const LEGACY_PATH_REDIRECTS: Record<string, string> = {
  '/': '/dashboard',
  '/settings': '/settings',
  '/settings/backup': '/settings/integration#backup',
  '/settings/display': '/settings/sales',
  '/settings/ui-scale': '/settings/appearance',
  '/reports': '/reports/financial',
  '/customers': '/customers/list',
  '/cashboxes': '/cashboxes/balances',
  '/platforms': '/platforms/list',
  '/purchases': '/purchases/invoices',
  '/sync': '/sync/pending',
  '/bulk-edit-excel': '/items/bulk-edit',
  '/items/import': '/items/bulk-edit',
  '/categories': '/items/categories'
};

export interface ResolvedNavigationRoute {
  page: PageType;
  tab?: string;
  path: string;
  search?: string;
  hash?: string;
  itemRoute?: { mode: 'new' } | { mode: 'edit'; itemId: string } | null;
  redirected: boolean;
}

export interface FeatureModeFlags {
  platformsEnabled?: boolean;
  salesOnlyMode?: boolean;
}

export const SALES_ONLY_ALLOWED_PAGES = new Set<PageType>([
  'pos',
  'invoices',
  'customers',
  'credit_collection',
  'settings',
  'delivery_orders',
  'delivery_my_orders',
  'sync',
  'visitor'
]);

/**
 * فحص إتاحة صفحة/تبويب وفق أوضاع التشغيل العامة (تعطيل المنصات / وضع البيع فقط)
 */
export function isPageAllowedByFeatureModes(
  page: PageType,
  tab?: string,
  flags?: FeatureModeFlags
): boolean {
  const salesOnly = Boolean(flags?.salesOnlyMode);
  const platformsOn = flags?.platformsEnabled !== false && !salesOnly;

  if (!platformsOn) {
    if (page === 'platforms') return false;
    if (page === 'reports' && tab === 'BNPL') return false;
  }

  if (salesOnly) {
    if (!SALES_ONLY_ALLOWED_PAGES.has(page)) return false;
    if (page === 'settings' && tab === 'labels') return false;
  }

  return true;
}

/**
 * دالة فحص الرؤية لعنصر فرعي
 */
export function isSubItemVisible(
  item: NavSubItem,
  user: UserAccount | null,
  flags?: FeatureModeFlags
): boolean {
  if (!isPageAllowedByFeatureModes(item.page, item.tab, flags)) return false;
  if (!item.permission) return true;
  if (user?.role === 'designer' || Boolean(user?.isOwner)) return true;
  if (typeof item.permission === 'function') {
    return item.permission(user);
  }
  if (Array.isArray(item.permission)) {
    return item.permission.some((p) => hasPermission(user, p as any));
  }
  return hasPermission(user, item.permission as any);
}

/**
 * التحقق مما إذا كان المستخدم «حساب شاشة» مخصص لشاشة الزوار فقط:
 * معه صلاحية visitor.display وليس معه أي صلاحية أخرى تفتح صفحة غيرها
 */
export function isVisitorScreenOnlyUser(user: UserAccount | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'designer' || Boolean(user.isOwner)) return false;
  if (!hasPermission(user, 'visitor.display')) return false;
  const hasAnyOtherPageAccess = ALL_ROUTE_SUB_ITEMS.some(
    (sub) => sub.page !== 'visitor' && isSubItemVisible(sub, user)
  );
  return !hasAnyOtherPageAccess;
}

/**
 * دالة فحص الرؤية لمجموعة كاملة: تظهر فقط إذا كان للمستخدم وصول لصلاحية المجموعة ولديه عنصر فرعي واحد على الأقل مسموح
 */
export function isGroupVisible(
  group: NavGroup,
  user: UserAccount | null,
  flags?: FeatureModeFlags
): boolean {
  const salesOnly = Boolean(flags?.salesOnlyMode);
  const platformsOn = flags?.platformsEnabled !== false && !salesOnly;
  if (!platformsOn && group.id === 'platforms') return false;

  const hasVisibleSubItem = group.subItems.some((sub) => isSubItemVisible(sub, user, flags));
  if (!hasVisibleSubItem) return false;

  if (user?.role === 'designer' || Boolean(user?.isOwner)) return true;
  if (group.permission) {
    let allowed = false;
    if (typeof group.permission === 'function') {
      allowed = group.permission(user);
    } else if (Array.isArray(group.permission)) {
      allowed = group.permission.some((p) => hasPermission(user, p as any));
    } else {
      allowed = hasPermission(user, group.permission as any);
    }
    if (!allowed) return false;
  }
  return true;
}

/**
 * دالة إيجاد المجموعة التي تنتمي إليها الصفحة والتبويب الحاليين
 */
export function findGroupForPage(page: PageType, tab?: string): NavGroup | undefined {
  if (tab) {
    const exactMatch = NAV_GROUPS.find((g) =>
      g.subItems.some((s) => s.page === page && s.tab === tab)
    );
    if (exactMatch) return exactMatch;
  }
  const ownGroup = NAV_GROUPS.find(
    (g) => g.id === page && g.subItems.some((s) => s.page === page)
  );
  if (ownGroup) return ownGroup;
  return NAV_GROUPS.find((g) => g.subItems.some((s) => s.page === page));
}

/**
 * إيجاد العنصر الفرعي المطابق لصفحة وتبويب معينين (مع مراعاة صلاحيات المستخدم وأوضاع التشغيل)
 */
export function findSubItemForTarget(
  page: PageType,
  tab?: string,
  user?: UserAccount | null,
  flags?: FeatureModeFlags
): NavSubItem | undefined {
  const matchingGroup = NAV_GROUPS.find((g) => g.id === page);
  const groupCandidates = matchingGroup
    ? matchingGroup.subItems.filter((s) => s.page === page)
    : [];
  const otherCandidates = ALL_ROUTE_SUB_ITEMS.filter(
    (s) => s.page === page && !groupCandidates.includes(s)
  );
  const candidates = [...groupCandidates, ...otherCandidates].filter((s) =>
    isPageAllowedByFeatureModes(s.page, s.tab, flags)
  );
  if (candidates.length === 0) return undefined;

  if (tab) {
    const exact = candidates.find((s) => s.tab === tab);
    if (exact && (!user || isSubItemVisible(exact, user, flags))) return exact;
  }

  // إن كان للعنصر تبويب افتراضي 'ALL' أو بدون تبويب، نفضله أولاً
  const withoutTabOrAll = candidates.find((s) => !s.tab || s.tab === 'ALL');
  if (!tab && withoutTabOrAll) {
    if (!user || isSubItemVisible(withoutTabOrAll, user, flags)) {
      return withoutTabOrAll;
    }
  }

  if (user) {
    const firstAllowed = candidates.find((s) => isSubItemVisible(s, user, flags));
    if (firstAllowed) return firstAllowed;
    return undefined;
  }

  return withoutTabOrAll || candidates[0];
}

export function canUserCreateItem(
  user?: UserAccount | null,
  flags?: FeatureModeFlags
): boolean {
  if (!isPageAllowedByFeatureModes('items', 'ALL', flags)) {
    return false;
  }
  if (!user) return true;
  if (user.role === 'designer' || Boolean(user.isOwner)) return true;
  return hasPermission(user, 'items.view') && hasPermission(user, 'items.create');
}

export function canUserEditItem(
  user?: UserAccount | null,
  flags?: FeatureModeFlags
): boolean {
  if (!isPageAllowedByFeatureModes('items', 'ALL', flags)) {
    return false;
  }
  if (!user) return true;
  if (user.role === 'designer' || Boolean(user.isOwner)) return true;
  return hasPermission(user, 'items.view') && hasPermission(user, 'items.edit');
}

export function getDefaultHomeTarget(flags?: FeatureModeFlags): { page: PageType; path: string } {
  return flags?.salesOnlyMode
    ? { page: 'pos', path: '/pos' }
    : { page: 'dashboard', path: '/dashboard' };
}

/**
 * توحيد الهدف (الصفحة + التبويب + المسار القانوني) مع تحويل المسارات القديمة ومراعاة أوضاع التشغيل وصلاحيات المستخدم تلقائياً
 */
export function normalizeNavigationTarget(
  page: PageType,
  tab?: string,
  user?: UserAccount | null,
  flags?: FeatureModeFlags
): { page: PageType; tab?: string; path: string } {
  if (isVisitorScreenOnlyUser(user)) {
    return {
      page: 'visitor',
      tab: undefined,
      path: '/visitor'
    };
  }
  if (page === 'visitor') {
    return {
      page: 'visitor',
      tab: undefined,
      path: '/visitor'
    };
  }
  const isLegacyBackupTab = page === 'settings' && tab === 'backup';
  const lookupTab =
    page === 'settings' && tab === 'display'
      ? 'sales'
      : page === 'settings' && tab === 'ui_scale'
      ? 'appearance'
      : isLegacyBackupTab
      ? 'integration'
      : page === 'reports' && tab === 'BNPL' && (flags?.platformsEnabled === false || flags?.salesOnlyMode)
      ? 'FINANCIAL'
      : tab;

  if (isPageAllowedByFeatureModes(page, lookupTab, flags)) {
    const matched = findSubItemForTarget(page, lookupTab, user, flags);
    if (matched) {
      const resolvedTab = matched.tab ?? lookupTab;
      const appendBackupHash = isLegacyBackupTab && resolvedTab === 'integration';
      return {
        page: matched.page,
        tab: resolvedTab,
        path: appendBackupHash ? `${matched.path}#backup` : matched.path
      };
    }
  }

  const fallbackOrder: PageType[] = flags?.salesOnlyMode
    ? [
        'pos',
        'invoices',
        'customers',
        'credit_collection',
        'delivery_orders',
        'delivery_my_orders',
        'sync',
        'settings',
        'visitor'
      ]
    : [
        'dashboard',
        'pos',
        'invoices',
        'items',
        'customers',
        'purchases',
        'cashboxes',
        'reports',
        'warehouses',
        'warehouse_transfers',
        'warehouse_dispatch_orders',
        'returns',
        'credit_collection',
        'delivery_orders',
        'delivery_settlements',
        'delivery_my_orders',
        'delivery_reports',
        'delivery_settings',
        'categories',
        'bulk_edit_excel',
        'label_print',
        'sync',
        'permissions',
        'audit',
        'settings',
        'visitor'
      ];

  for (const candidatePage of fallbackOrder) {
    const candidate = findSubItemForTarget(candidatePage, undefined, user, flags);
    if (candidate) {
      return {
        page: candidate.page,
        tab: candidate.tab,
        path: candidate.path
      };
    }
  }

  const home = getDefaultHomeTarget(flags);
  return {
    page: home.page,
    tab: undefined,
    path: home.path
  };
}

const CONTEXTUAL_QUERY_KEYS = new Set([
  'search',
  'supplierId',
  'customerId',
  'cashboxId',
  'platformId',
  'category',
  'itemId',
  'operationType'
]);

function extractContextualQueryString(searchParams: URLSearchParams): string {
  const kept = new URLSearchParams();
  CONTEXTUAL_QUERY_KEYS.forEach((key) => {
    const val = searchParams.get(key);
    if (val !== null && val.trim() !== '') {
      kept.set(key, val);
    }
  });
  const str = kept.toString();
  return str ? `?${str}` : '';
}

function buildUrlFromParts(basePath: string, search?: string, hash?: string): string {
  const cleanHash = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
  const cleanSearch = search ? (search.startsWith('?') ? search : `?${search}`) : '';
  const hashIdx = basePath.indexOf('#');
  const pathWithoutHash = hashIdx >= 0 ? basePath.slice(0, hashIdx) : basePath;
  const existingHash = hashIdx >= 0 ? basePath.slice(hashIdx) : '';
  return `${pathWithoutHash}${cleanSearch}${cleanHash || existingHash}`;
}

export interface HrefBuildOptions {
  searchParams?: Record<string, string | undefined | null>;
  hash?: string;
  user?: UserAccount | null;
  flags?: FeatureModeFlags;
}

/**
 * بناء مسار href حقيقي ومعتمد لأي صفحة/تبويب داخلي مع دعم معاملات الاستعلام والهاش
 */
export function getHrefForTarget(
  page: PageType,
  tab?: string,
  options?: HrefBuildOptions
): string {
  const normalized = normalizeNavigationTarget(page, tab, options?.user, options?.flags);
  const qs = new URLSearchParams();
  if (options?.searchParams) {
    Object.entries(options.searchParams).forEach(([key, val]) => {
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        qs.set(key, String(val));
      }
    });
  }
  const searchStr = qs.toString() ? `?${qs.toString()}` : '';
  return buildUrlFromParts(normalized.path, searchStr, options?.hash);
}

/**
 * بناء مسار href حقيقي لشاشة الصنف (/items/new أو /items/:id)
 */
export function getHrefForItemRoute(
  mode: 'new' | 'edit',
  itemId?: string
): string {
  if (mode === 'new' || !itemId) {
    return '/items/new';
  }
  return `/items/${encodeURIComponent(itemId)}`;
}

/**
 * التحقق مما إذا كانت النقرة نقرة زر أيسر عادية دون Ctrl/Cmd/Shift/Alt
 * حتى تعمل نقرات Ctrl/Cmd وزر الفأرة الأوسط و"فتح في تبويب جديد" عبر المتصفح بشكل طبيعي
 */
export function isPlainLeftClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * تحليل مسار المتصفح (Pathname + Query + Hash) وإرجاع الصفحة والتبويب والمسار القانوني،
 * مع دعم المسارات القديمة ومسارات الأصناف المستقلة (/items/new و /items/:id) وروابط الأقسام السياقية
 * والتحقق من صلاحية العنصر الفرعي نفسه عبر isSubItemVisible وصلاحيات items.create و items.edit
 */
export function resolvePathToTarget(
  rawPathnameOrUrl: string,
  user?: UserAccount | null,
  flags?: FeatureModeFlags
): ResolvedNavigationRoute {
  let rawPathname = '/';
  let rawSearchParams = new URLSearchParams();
  let rawHash = '';
  try {
    const parsed = new URL(rawPathnameOrUrl || '/', 'http://local');
    rawPathname = parsed.pathname || '/';
    rawSearchParams = parsed.searchParams;
    rawHash = parsed.hash || '';
  } catch {
    rawPathname = rawPathnameOrUrl || '/';
  }

  const trimmed = rawPathname.replace(/\/+$/, '') || '/';
  const contextualSearch = extractContextualQueryString(rawSearchParams);

  if (isVisitorScreenOnlyUser(user)) {
    return {
      page: 'visitor',
      tab: undefined,
      path: '/visitor',
      search: '',
      hash: '',
      itemRoute: null,
      redirected: trimmed !== '/visitor'
    };
  }

  // 0. دعم ?section=<SettingsSectionId> على /settings
  if (trimmed === '/settings') {
    const sectionParam = rawSearchParams.get('section')?.trim();
    if (sectionParam) {
      const targetTab = sectionParam === 'backup' ? 'integration' : sectionParam;
      const hashToApply = sectionParam === 'backup' ? '#backup' : rawHash;
      const normalized = normalizeNavigationTarget('settings', targetTab, user, flags);
      const finalPath = buildUrlFromParts(normalized.path, '', hashToApply);
      return {
        page: normalized.page,
        tab: normalized.tab,
        path: finalPath,
        search: '',
        hash: finalPath.includes('#') ? `#${finalPath.split('#')[1]}` : '',
        itemRoute: null,
        redirected: true
      };
    }
  }

  // 1. المسارات القديمة تُحوَّل تلقائياً لأول عنصر مسموح للمستخدم في الصفحة أو الوضع الحالي
  const legacyEntry = LEGACY_PAGE_REDIRECTS[trimmed];
  if (legacyEntry) {
    const requestedPage = legacyEntry.page === 'dashboard' && flags?.salesOnlyMode ? 'pos' : legacyEntry.page;
    const normalized = normalizeNavigationTarget(requestedPage, legacyEntry.tab, user, flags);
    const shouldAppendHash =
      Boolean(legacyEntry.hash) &&
      !normalized.path.includes('#') &&
      normalized.page === requestedPage &&
      (!legacyEntry.tab || normalized.tab === legacyEntry.tab);
    const effectiveHash = shouldAppendHash ? legacyEntry.hash! : rawHash;
    const keepContextual = normalized.page === requestedPage ? contextualSearch : '';
    const finalPath = buildUrlFromParts(normalized.path, keepContextual, effectiveHash);
    return {
      page: normalized.page,
      tab: normalized.tab,
      path: finalPath,
      search: keepContextual,
      hash: finalPath.includes('#') ? `#${finalPath.split('#')[1]}` : '',
      itemRoute: null,
      redirected: finalPath !== `${trimmed}${rawSearchParams.toString() ? `?${rawSearchParams.toString()}` : ''}${rawHash}`
    };
  }

  // 2. مطابقة أي مسار مستقل معرف في NAV_GROUPS أو SETTINGS_DIRECT_ROUTES أولاً (حتى لا تتصادم مسارات /items/* مع /items/:id)
  const matchedSub = ALL_ROUTE_SUB_ITEMS.find((s) => s.path === trimmed);
  if (matchedSub) {
    const isSubAllowed = user
      ? isSubItemVisible(matchedSub, user, flags)
      : isPageAllowedByFeatureModes(matchedSub.page, matchedSub.tab, flags);

    if (isSubAllowed) {
      const finalPath = buildUrlFromParts(matchedSub.path, contextualSearch, rawHash);
      return {
        page: matchedSub.page,
        tab: matchedSub.tab,
        path: finalPath,
        search: contextualSearch,
        hash: rawHash,
        itemRoute: null,
        redirected: false
      };
    }
    const redirectedTarget = normalizeNavigationTarget(matchedSub.page, matchedSub.tab, user, flags);
    return {
      page: redirectedTarget.page,
      tab: redirectedTarget.tab,
      path: redirectedTarget.path,
      search: '',
      hash: redirectedTarget.path.includes('#') ? `#${redirectedTarget.path.split('#')[1]}` : '',
      itemRoute: null,
      redirected: true
    };
  }

  // 3. مسارات شاشة الصنف المستقلة مع التحقق الصريح من items.create و items.edit
  if (trimmed === '/items/new') {
    if (!canUserCreateItem(user, flags)) {
      const redirectedTarget = normalizeNavigationTarget('items', 'ALL', user, flags);
      return {
        page: redirectedTarget.page,
        tab: redirectedTarget.tab,
        path: redirectedTarget.path,
        search: '',
        hash: '',
        itemRoute: null,
        redirected: true
      };
    }
    const finalPath = buildUrlFromParts('/items/new', contextualSearch, rawHash);
    return {
      page: 'items',
      tab: 'ALL',
      path: finalPath,
      search: contextualSearch,
      hash: rawHash,
      itemRoute: { mode: 'new' },
      redirected: false
    };
  }

  if (trimmed.startsWith('/items/') && trimmed.length > '/items/'.length) {
    if (!canUserEditItem(user, flags)) {
      const redirectedTarget = normalizeNavigationTarget('items', 'ALL', user, flags);
      return {
        page: redirectedTarget.page,
        tab: redirectedTarget.tab,
        path: redirectedTarget.path,
        search: '',
        hash: '',
        itemRoute: null,
        redirected: true
      };
    }
    const itemId = decodeURIComponent(trimmed.slice('/items/'.length));
    const baseItemPath = `/items/${encodeURIComponent(itemId)}`;
    const finalPath = buildUrlFromParts(baseItemPath, contextualSearch, rawHash);
    return {
      page: 'items',
      tab: 'ALL',
      path: finalPath,
      search: contextualSearch,
      hash: rawHash,
      itemRoute: { mode: 'edit', itemId },
      redirected: false
    };
  }

  // 4. مسار غير معروف -> توجيه تلقائي للوحة التحكم أو نقطة البيع في وضع البيع فقط
  const home = getDefaultHomeTarget(flags);
  const fallback = normalizeNavigationTarget(home.page, undefined, user, flags);
  return {
    page: fallback.page,
    tab: fallback.tab,
    path: fallback.path,
    search: '',
    hash: '',
    itemRoute: null,
    redirected: trimmed !== fallback.path
  };
}


