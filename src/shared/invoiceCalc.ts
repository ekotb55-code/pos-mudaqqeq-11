import type {
  Item,
  Platform,
  InvoiceLine,
  TaxSettings
} from '../types';

export interface InvoiceLinePayloadInput {
  itemId?: string;
  itemName?: string;
  quantity?: number;
  salePriceAtSale?: number;
  baseUnitPrice?: number;
  taxRateAtSale?: number;
  bnplPercent?: number;
  unitPickupFee?: number;
  barcodeAtSale?: string;
  shippingCostAtSale?: number;
}

export interface InvoiceLineCalcInput extends InvoiceLinePayloadInput {
  item?: Item;
  line?: InvoiceLinePayloadInput;
  platformShippingCost?: number;
}

export interface SingleLineCalcParams {
  line?: InvoiceLinePayloadInput;
  item: Pick<
    Item,
    | 'id'
    | 'name'
    | 'printName'
    | 'salePrice'
    | 'purchasePrice'
    | 'packagingCost'
    | 'taxRate'
    | 'pickupFee'
    | 'enableBnpl'
    | 'bnplPercentage'
    | 'barcode'
    | 'secondaryBarcodes'
  >;
  quantity?: number;
  invoiceNumber?: string;
  platform?: Partial<Platform> | null;
  taxSettings?: Partial<TaxSettings> | null;
  salePriceAtSale?: number;
  taxRateAtSale?: number;
  lineBnplPercent?: number;
  unitPickupFeeOverride?: number;
  barcodeAtSale?: string;
  bnplEnabled?: boolean;
  bnplPercentOverride?: number;
  bnplPercentOverrideVal?: number;
  platformDiscountPercent: number;
  preferLineBnplPercent?: boolean;
}

export interface CalculatedLineDetails extends InvoiceLine {
  unitBasePrice: number;
  basePriceForUnit: number;
  unitRevenueExcludingTax: number;
  taxAmount?: number;
  linePickupFee?: number;
  lineTotal?: number;
  lineCost?: number;
  lineNetProfit?: number;
}

export interface InvoiceCalcInput {
  invoiceNumber?: string;
  lines: InvoiceLineCalcInput[];
  items?: Item[];
  itemsById?: Map<string, Item> | Record<string, Item>;
  platform?: Partial<Platform> | null;
  taxSettings?: Partial<TaxSettings> | null;
  deliveryFee?: number | string | null;
  bnplEnabled?: boolean;
  bnplPercentOverride?: number | string | null;
  bnplPercentOverrideVal?: number | string | null;
  commissionPercentOverride?: number | string | null;
  platformDiscountPercentage?: number | string | null;
  platformDiscountPercent?: number | string | null;
  defaultCommissionPercent?: number;
  preferLineBnplPercent?: boolean;
}

export interface InvoiceCalcResult {
  lines: CalculatedLineDetails[];
  invoiceLines: InvoiceLine[];
  totalBeforeDiscount: number;
  totalBnpl: number;
  bnplTotalAmount: number;
  totalDiscount: number;
  discountPercentage: number;
  discountAmount: number;
  pickupFeePerUnit: number;
  totalPickupFee: number;
  pickupFeeAmount: number;
  totalTax: number;
  totalTaxAmount: number;
  totalCostSum: number;
  totalCost: number;
  deliveryFee: number;
  netBeforeDelivery: number;
  grossInvoiceTotal: number;
  netAmount: number;
  totalProfit: number;
  netProfit: number;
  bnplEnabled: boolean;
  bnplPercentApplied: number;
  commissionPercentApplied: number;
  platformDiscountPercent: number;
}

/**
 * دالة نقية لحساب تفاصيل سطر فاتورة واحد (بدون أي اعتماد على الخادم أو المتصفح)
 */
export function calculateInvoiceLine(params: SingleLineCalcParams): CalculatedLineDetails {
  const {
    line,
    item,
    quantity,
    invoiceNumber = '',
    platform,
    taxSettings,
    salePriceAtSale,
    taxRateAtSale,
    lineBnplPercent: inputLineBnplPercent,
    unitPickupFeeOverride,
    barcodeAtSale,
    bnplEnabled,
    bnplPercentOverride,
    bnplPercentOverrideVal,
    platformDiscountPercent,
    preferLineBnplPercent = false
  } = params;

  const resolvedQtyInput = quantity !== undefined ? quantity : line?.quantity;
  const qty = Number(resolvedQtyInput || 1);

  const resolvedSalePriceInput =
    salePriceAtSale !== undefined
      ? salePriceAtSale
      : line?.salePriceAtSale !== undefined
      ? line.salePriceAtSale
      : line?.baseUnitPrice !== undefined
      ? line.baseUnitPrice
      : item.salePrice;

  const salePriceForUnit =
    resolvedSalePriceInput !== undefined ? Number(resolvedSalePriceInput) : Number(item.salePrice || 0);

  const isBnplDisabled = bnplEnabled === false;

  const itemHasBnpl =
    Boolean(item.enableBnpl) &&
    item.bnplPercentage !== undefined &&
    Number(item.bnplPercentage) > 0;
  const itemBnplVal = itemHasBnpl ? Number(item.bnplPercentage) : undefined;

  const rawExplicitLineBnpl =
    inputLineBnplPercent !== undefined && inputLineBnplPercent !== null
      ? inputLineBnplPercent
      : line?.bnplPercent;

  const explicitLineBnplVal =
    rawExplicitLineBnpl !== undefined && rawExplicitLineBnpl !== null
      ? Number(rawExplicitLineBnpl)
      : undefined;

  const platformBnplVal =
    (bnplEnabled === true || Boolean(platform?.enableBnpl)) &&
    platform?.bnplPercentage !== undefined
      ? Number(platform.bnplPercentage)
      : 0;

  const effectiveBnplOverride =
    bnplPercentOverrideVal !== undefined ? bnplPercentOverrideVal : bnplPercentOverride;

  let resolvedBnplPercent = 0;
  if (!isBnplDisabled) {
    if (effectiveBnplOverride !== undefined) {
      resolvedBnplPercent = effectiveBnplOverride;
    } else if (preferLineBnplPercent) {
      resolvedBnplPercent =
        explicitLineBnplVal ?? itemBnplVal ?? platformBnplVal;
    } else {
      resolvedBnplPercent =
        itemBnplVal ?? explicitLineBnplVal ?? platformBnplVal;
    }
  }

  const baseUnitPrice = salePriceForUnit;
  const customerUnitPrice =
    resolvedBnplPercent > 0
      ? Math.round(baseUnitPrice * (1 + resolvedBnplPercent / 100) * 100) / 100
      : baseUnitPrice;
  const bnplUnitAmount =
    Math.round((customerUnitPrice - baseUnitPrice) * 100) / 100;
  const bnplDeductionUnit =
    resolvedBnplPercent > 0
      ? Math.round(customerUnitPrice * (resolvedBnplPercent / 100) * 100) / 100
      : 0;
  const totalBnplDeduction = bnplDeductionUnit * qty;

  const resolvedPickupFee =
    platform?.pickupFeeMode === 'product'
      ? item.pickupFee !== undefined &&
        item.pickupFee !== null &&
        Number(item.pickupFee) > 0
        ? Number(item.pickupFee)
        : Number(platform?.pickupFee || 0)
      : Number(platform?.pickupFee || 0);

  const rawUnitPickupOverride =
    unitPickupFeeOverride !== undefined ? unitPickupFeeOverride : line?.unitPickupFee;

  const unitPickupFee = Math.max(
    0,
    Number(
      rawUnitPickupOverride !== undefined
        ? rawUnitPickupOverride
        : resolvedPickupFee
    )
  );

  const purchasePriceForUnit = Number(item.purchasePrice || 0);
  const packagingCostForUnit = Number(item.packagingCost || 0);

  const rawTaxRate =
    taxRateAtSale !== undefined
      ? taxRateAtSale
      : line?.taxRateAtSale !== undefined
      ? line.taxRateAtSale
      : item.taxRate;
  const taxRate = Number(rawTaxRate !== undefined ? rawTaxRate : 0);

  const taxInclusive = taxSettings?.taxInclusive ?? true;
  const platformCommissionOn =
    taxSettings?.platformCommissionOn ??
    (taxSettings as any)?.platformCommissionBasis ??
    'before_tax';

  let basePriceForUnit = customerUnitPrice;
  let unitTaxAmount = 0;

  if (taxRate > 0) {
    if (taxInclusive) {
      basePriceForUnit = customerUnitPrice / (1 + taxRate / 100);
      unitTaxAmount = customerUnitPrice - basePriceForUnit;
    } else {
      basePriceForUnit = customerUnitPrice;
      unitTaxAmount = customerUnitPrice * (taxRate / 100);
    }
  }

  // احتساب خصم/عمولة المنصة على سعر العميل (قبل الضريبة أو بعدها حسب الإعداد)
  const commissionBase =
    platformCommissionOn === 'before_tax'
      ? basePriceForUnit
      : customerUnitPrice;
  const unitDiscountValue = commissionBase * (platformDiscountPercent / 100);

  // صافي الصنف = سعر العميل − استقطاع BNPL − خصم المنصة − رسوم الالتقاط
  const unitNet =
    customerUnitPrice - bnplDeductionUnit - unitDiscountValue - unitPickupFee;

  // الربح الصافي للمتجر
  const unitRevenueExcludingTax =
    customerUnitPrice -
    unitTaxAmount -
    bnplDeductionUnit -
    unitDiscountValue -
    unitPickupFee;
  const unitProfit =
    unitRevenueExcludingTax - purchasePriceForUnit - packagingCostForUnit;

  const resolvedBarcode =
    barcodeAtSale ||
    line?.barcodeAtSale ||
    item.barcode ||
    (item.secondaryBarcodes && item.secondaryBarcodes[0]) ||
    '';

  return {
    invoiceNumber,
    itemId: item.id,
    itemNameAtSale: item.name,
    itemPrintNameAtSale: item.printName ? String(item.printName).trim().slice(0, 120) : '',
    barcodeAtSale: resolvedBarcode,
    quantity: qty,
    salePriceAtSale: baseUnitPrice,
    baseUnitPrice,
    customerUnitPrice,
    bnplPercent: resolvedBnplPercent,
    bnplUnitAmount,
    totalBnplAmount: bnplUnitAmount * qty,
    bnplDeductionUnit,
    totalBnplDeduction,
    purchasePriceAtSale: purchasePriceForUnit,
    packagingCostAtSale: packagingCostForUnit,
    taxRateAtSale: taxRate,
    unitTaxAmount,
    platformDiscountPercentAtSale: platformDiscountPercent,
    unitDiscountValue,
    unitPickupFee,
    totalPickupFee: unitPickupFee * qty,
    unitNet,
    unitProfit,
    unitBasePrice: basePriceForUnit,
    basePriceForUnit,
    unitRevenueExcludingTax
  };
}

function resolveItemFromInput(
  entry: InvoiceLineCalcInput,
  items?: Item[],
  itemsById?: Map<string, Item> | Record<string, Item>
): Item | undefined {
  if (entry.item) return entry.item;
  const targetId = entry.itemId || entry.line?.itemId || '';
  if (!targetId) return undefined;
  if (itemsById) {
    if (itemsById instanceof Map) {
      return itemsById.get(targetId);
    }
    return itemsById[targetId];
  }
  if (Array.isArray(items)) {
    return items.find(i => i.id === targetId);
  }
  return undefined;
}

/**
 * دالة نقية لحساب السطور والإجماليات الكاملة للفاتورة
 * تعمل في الخادم والواجهة بدون أي اعتماد على بيئة التشغيل
 */
export function calculateInvoice(input: InvoiceCalcInput): InvoiceCalcResult {
  const {
    invoiceNumber = '',
    lines = [],
    items,
    itemsById,
    platform,
    taxSettings,
    bnplEnabled,
    bnplPercentOverride,
    bnplPercentOverrideVal: inputBnplOverrideVal,
    commissionPercentOverride,
    platformDiscountPercentage,
    platformDiscountPercent: inputPlatformDiscountPercent,
    defaultCommissionPercent,
    preferLineBnplPercent = false
  } = input;

  const rawBnplOverride =
    inputBnplOverrideVal !== undefined ? inputBnplOverrideVal : bnplPercentOverride;
  const hasBnplPercentOverride =
    rawBnplOverride !== undefined &&
    rawBnplOverride !== null &&
    rawBnplOverride !== '';
  const bnplPercentOverrideVal = hasBnplPercentOverride
    ? Number(rawBnplOverride)
    : undefined;

  const hasCommissionPercentOverride =
    commissionPercentOverride !== undefined &&
    commissionPercentOverride !== null &&
    commissionPercentOverride !== '';
  const commissionPercentOverrideVal = hasCommissionPercentOverride
    ? Number(commissionPercentOverride)
    : undefined;

  const fallbackPlatformDiscount =
    defaultCommissionPercent !== undefined
      ? Number(defaultCommissionPercent)
      : Number(platform?.discountPercentage || 0);

  const rawPlatformDisc =
    inputPlatformDiscountPercent !== undefined
      ? inputPlatformDiscountPercent
      : platformDiscountPercentage;

  const platformDiscountPercent =
    commissionPercentOverrideVal !== undefined
      ? commissionPercentOverrideVal
      : rawPlatformDisc !== undefined &&
        rawPlatformDisc !== null &&
        rawPlatformDisc !== ''
      ? Number(rawPlatformDisc)
      : fallbackPlatformDiscount;

  const isBnplDisabled = bnplEnabled === false;

  let deliveryFee = 0;
  if (
    input.deliveryFee !== undefined &&
    input.deliveryFee !== null &&
    input.deliveryFee !== ''
  ) {
    const rawDelivery = Number(input.deliveryFee);
    if (!isNaN(rawDelivery) && rawDelivery >= 0) {
      deliveryFee = Math.round(rawDelivery * 100) / 100;
    }
  }

  let totalBeforeDiscount = 0;
  let totalBnpl = 0;
  let totalDiscount = 0;
  let totalPickupFee = 0;
  let totalTax = 0;
  let totalCostSum = 0;

  const calculatedLines: CalculatedLineDetails[] = [];
  const invoiceLines: InvoiceLine[] = [];

  for (const entry of lines) {
    const lineObj: InvoiceLinePayloadInput = entry.line ? entry.line : entry;
    const item = resolveItemFromInput(entry, items, itemsById);
    if (!item) {
      throw new Error(`الصنف غير موجود بالمخزن: ${lineObj.itemId || ''}`);
    }

    const salePriceInput =
      lineObj.salePriceAtSale !== undefined
        ? Number(lineObj.salePriceAtSale)
        : lineObj.baseUnitPrice !== undefined
        ? Number(lineObj.baseUnitPrice)
        : item.salePrice;

    const lineCalc = calculateInvoiceLine({
      line: lineObj,
      item,
      quantity: lineObj.quantity,
      invoiceNumber,
      platform,
      taxSettings,
      salePriceAtSale: salePriceInput,
      taxRateAtSale: lineObj.taxRateAtSale,
      lineBnplPercent: lineObj.bnplPercent,
      unitPickupFeeOverride: lineObj.unitPickupFee,
      barcodeAtSale: lineObj.barcodeAtSale,
      bnplEnabled,
      bnplPercentOverride: bnplPercentOverrideVal,
      platformDiscountPercent,
      preferLineBnplPercent
    });

    const qty = lineCalc.quantity;
    const purchasePriceForUnit = lineCalc.purchasePriceAtSale || 0;
    const packagingCostForUnit = lineCalc.packagingCostAtSale || 0;

    totalBeforeDiscount += (lineCalc.customerUnitPrice || 0) * qty;
    totalBnpl += lineCalc.totalBnplDeduction || 0;
    totalDiscount += lineCalc.unitDiscountValue * qty;
    totalPickupFee += (lineCalc.unitPickupFee || 0) * qty;
    totalTax += (lineCalc.unitTaxAmount || 0) * qty;
    totalCostSum += (purchasePriceForUnit + packagingCostForUnit) * qty;

    calculatedLines.push(lineCalc);

    const {
      unitBasePrice: _ub,
      basePriceForUnit: _bp,
      unitRevenueExcludingTax: _ur,
      taxAmount: _ta,
      linePickupFee: _lpf,
      lineTotal: _lt,
      lineCost: _lc,
      lineNetProfit: _lnp,
      ...pureInvoiceLine
    } = lineCalc;
    invoiceLines.push(pureInvoiceLine);
  }

  // صافي المنتجات = إجمالي المنتجات − استقطاع BNPL − خصم المنصة − رسوم الالتقاط
  const netBeforeDelivery =
    totalBeforeDiscount - totalBnpl - totalDiscount - totalPickupFee;
  // إجمالي الفاتورة (سعر العميل + رسوم التوصيل)
  const grossInvoiceTotal =
    Math.round((totalBeforeDiscount + deliveryFee) * 100) / 100;
  // المطلوب من العميل / صافي الفاتورة = صافي المنتجات + رسوم التوصيل
  const netAmount =
    Math.round((netBeforeDelivery + deliveryFee) * 100) / 100;
  const totalProfit = invoiceLines.reduce(
    (sum, l) => sum + (l.unitProfit || 0) * l.quantity,
    0
  );

  const bnplPercentApplied = isBnplDisabled
    ? 0
    : bnplPercentOverrideVal !== undefined
    ? bnplPercentOverrideVal
    : invoiceLines.find(l => (l.bnplPercent || 0) > 0)?.bnplPercent ??
      (bnplEnabled === true || platform?.enableBnpl
        ? Number(platform?.bnplPercentage || 0)
        : 0);

  const commissionPercentApplied = platformDiscountPercent;
  const effectiveBnplEnabled =
    !isBnplDisabled &&
    (Boolean(bnplEnabled) || totalBnpl > 0 || Boolean(platform?.enableBnpl));

  const pickupFeePerUnit = Number(platform?.pickupFee || 0);

  return {
    lines: calculatedLines,
    invoiceLines,
    totalBeforeDiscount,
    totalBnpl,
    bnplTotalAmount: totalBnpl,
    totalDiscount,
    discountPercentage: platformDiscountPercent,
    discountAmount: totalDiscount,
    pickupFeePerUnit,
    totalPickupFee,
    pickupFeeAmount: totalPickupFee,
    totalTax,
    totalTaxAmount: totalTax,
    totalCostSum,
    totalCost: totalCostSum,
    deliveryFee,
    netBeforeDelivery,
    grossInvoiceTotal,
    netAmount,
    totalProfit,
    netProfit: totalProfit,
    bnplEnabled: effectiveBnplEnabled,
    bnplPercentApplied,
    commissionPercentApplied,
    platformDiscountPercent
  };
}
