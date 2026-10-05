import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../middleware/validate.js';
import { authenticate, requirePermission, scopeOf } from '../middleware/auth.js';
import { config } from '../../config.js';
import { badRequest } from '../../domain/errors.js';
import { SCAN_TYPES, PAYMENT_METHODS } from '../../domain/enums.js';
import { getScanForReview, listScans, processScan, reviewScan, uploadScan } from '../../services/scanner/pipeline.js';
import { approveScan, rejectScan } from '../../services/scanner/approval.js';
import { objectStorage } from '../../storage/objectStorage.js';
import { prisma } from '../../db/prisma.js';
import { notFound } from '../../domain/errors.js';

export const scannerRouter: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
    cb(null, allowed.includes(file.mimetype));
  },
});

scannerRouter.use(authenticate);

/**
 * Upload is deliberately separate from processing: the phone can hand over the
 * photo and get on with billing while the read happens in the background.
 */
scannerRouter.post(
  '/upload',
  requirePermission('scanner:use'),
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw badRequest('Please take a photo first.', [{ label: 'Open Camera', action: 'OPEN_CAMERA' }]);
    }
    const scanType = String(req.body.scanType ?? 'INVOICE').toUpperCase();
    if (!SCAN_TYPES.includes(scanType as never)) throw badRequest('Unknown scan type.');

    const barcodes = parseBarcodes(req.body.barcodes);
    const result = await uploadScan(scopeOf(req), {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      scanType: scanType as never,
      ocrText: typeof req.body.ocrText === 'string' ? req.body.ocrText : undefined,
      barcodes,
      supplierId: req.body.supplierId || null,
    });

    if (!result.quality.ok) {
      res.status(422).json({
        error: {
          code: 'POOR_IMAGE_QUALITY',
          message: result.quality.advice ?? 'The photo could not be read.',
          actions: [
            { label: 'Take Another Photo', action: 'RETAKE' },
            { label: 'Enter Manually', action: 'MANUAL_ENTRY' },
          ],
        },
        scanId: result.scan.id,
      });
      return;
    }

    res.status(201).json({ scan: result.scan, quality: result.quality });
  }),
);

scannerRouter.post(
  '/:id/process',
  requirePermission('scanner:use'),
  asyncHandler(async (req, res) => {
    const result = await processScan(scopeOf(req), req.params.id);
    res.json(await getScanForReview(scopeOf(req), result.scan.id));
  }),
);

/** Convenience for the "Scan Invoice" button: upload and read in one call. */
scannerRouter.post(
  '/scan',
  requirePermission('scanner:use'),
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Please take a photo first.');
    const scanType = String(req.body.scanType ?? 'INVOICE').toUpperCase();
    if (!SCAN_TYPES.includes(scanType as never)) throw badRequest('Unknown scan type.');

    const scope = scopeOf(req);
    const { scan, quality } = await uploadScan(scope, {
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      scanType: scanType as never,
      ocrText: typeof req.body.ocrText === 'string' ? req.body.ocrText : undefined,
      barcodes: parseBarcodes(req.body.barcodes),
      supplierId: req.body.supplierId || null,
    });

    if (!quality.ok) {
      res.status(422).json({
        error: {
          code: 'POOR_IMAGE_QUALITY',
          message: quality.advice ?? 'The photo could not be read.',
          actions: [
            { label: 'Take Another Photo', action: 'RETAKE' },
            { label: 'Enter Manually', action: 'MANUAL_ENTRY' },
          ],
        },
        scanId: scan.id,
      });
      return;
    }

    await processScan(scope, scan.id);
    res.status(201).json(await getScanForReview(scope, scan.id));
  }),
);

scannerRouter.get(
  '/',
  requirePermission('scanner:use'),
  asyncHandler(async (req, res) => {
    const { status, scanType, limit } = req.query;
    res.json({
      scans: await listScans(scopeOf(req), {
        status: typeof status === 'string' ? status : undefined,
        scanType: typeof scanType === 'string' ? scanType : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    });
  }),
);

scannerRouter.get(
  '/:id',
  requirePermission('scanner:use'),
  asyncHandler(async (req, res) => {
    res.json(await getScanForReview(scopeOf(req), req.params.id));
  }),
);

scannerRouter.get(
  '/:id/image',
  requirePermission('scanner:use'),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const scan = await prisma.imageScan.findFirst({
      where: { id: req.params.id, businessId: scope.businessId },
    });
    if (!scan) throw notFound('Scan');
    const buffer = await objectStorage.get(scan.imageRef);
    res.setHeader('Content-Type', scan.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }),
);

scannerRouter.post(
  '/:id/review',
  requirePermission('scanner:use'),
  validateBody(
    z.object({
      corrections: z
        .array(
          z.object({
            itemId: z.string(),
            matchedVariantId: z.string().nullable().optional(),
            createNewProduct: z.boolean().optional(),
            productName: z.string().max(200).optional(),
            quantity: z.number().nullable().optional(),
            purchasePricePaise: z.number().int().min(0).nullable().optional(),
            sellingPricePaise: z.number().int().min(0).nullable().optional(),
            mrpPaise: z.number().int().min(0).nullable().optional(),
            taxRate: z.number().min(0).max(100).nullable().optional(),
            batch: z.string().max(40).nullable().optional(),
            expiry: z.string().nullable().optional(),
            reviewState: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'NEEDS_INPUT']).optional(),
          }),
        )
        .min(1),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await reviewScan(scopeOf(req), req.params.id, req.body.corrections));
  }),
);

scannerRouter.post(
  '/:id/approve',
  requirePermission('scanner:approve'),
  validateBody(
    z.object({
      acceptedItemIds: z.array(z.string()).min(1, 'Select at least one product to confirm'),
      rejectedItemIds: z.array(z.string()).optional(),
      supplierId: z.string().nullable().optional(),
      supplierName: z.string().max(200).nullable().optional(),
      invoiceNumber: z.string().max(60).nullable().optional(),
      invoiceDate: z.string().nullable().optional(),
      payment: z
        .object({
          method: z.enum(PAYMENT_METHODS),
          amountPaise: z.number().int().min(0),
          reference: z.string().max(60).optional(),
        })
        .nullable()
        .optional(),
      note: z.string().max(300).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await approveScan(scopeOf(req), req.params.id, req.body));
  }),
);

scannerRouter.post(
  '/:id/reject',
  requirePermission('scanner:use'),
  validateBody(z.object({ reason: z.string().min(2).max(200) })),
  asyncHandler(async (req, res) => {
    res.json(await rejectScan(scopeOf(req), req.params.id, req.body.reason));
  }),
);

function parseBarcodes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}
