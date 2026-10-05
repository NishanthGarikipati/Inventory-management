import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';
import type { ExtractionProvider, ExtractionRequest, ExtractionResult } from '../types.js';
import { extractionSchema } from '../validation.js';

const SYSTEM_PROMPT = `You read photos taken by Indian small shop owners: supplier invoices, product labels, shelves and handwritten stock sheets.
Return ONLY JSON matching the given schema. Rules:
- Never invent a product, quantity or price. Use null when unsure.
- confidence is 0..1 per item, and fieldConfidence gives per-field values.
- Prices are in rupees (numbers only, no currency symbol).
- Quantity is the number of units received/counted.
- For shelf photos, quantity is an estimate; keep confidence low.
- If the photo holds more than one document, set multipleDocuments true.`;

/**
 * Production extraction path. The API key stays on the server - the mobile app
 * never sees it - and the response is schema-validated before anything is
 * written anywhere.
 */
export class OpenAiVisionProvider implements ExtractionProvider {
  readonly name = 'openai-vision';

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    if (!config.openAiApiKey) {
      throw new Error('AI provider is not configured');
    }

    const userPrompt = buildUserPrompt(request);
    const body = {
      model: config.openAiModel,
      temperature: 0,
      response_format: { type: 'json_object' as const },
      messages: [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: userPrompt },
            {
              type: 'image_url' as const,
              image_url: {
                url: `data:${request.mimeType};base64,${request.imageBuffer.toString('base64')}`,
                detail: 'high' as const,
              },
            },
          ],
        },
      ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${config.openAiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.openAiApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text();
        logger.error({ status: response.status, detail }, 'vision provider failed');
        throw new Error(`Vision provider returned ${response.status}`);
      }

      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content ?? '{}';
      const parsed = extractionSchema.parse(JSON.parse(content));

      return {
        provider: this.name,
        supplier: parsed.supplier ?? null,
        invoiceNumber: parsed.invoice_number ?? null,
        invoiceDate: parsed.invoice_date ?? null,
        multipleDocuments: parsed.multiple_documents ?? false,
        items: parsed.items.map((item) => ({
          productName: item.product_name,
          quantity: item.quantity ?? null,
          unit: item.unit ?? null,
          purchasePrice: item.purchase_price ?? null,
          sellingPrice: item.selling_price ?? null,
          mrp: item.mrp ?? null,
          barcode: item.barcode ?? null,
          batch: item.batch ?? null,
          expiry: item.expiry ?? null,
          taxRate: item.tax_rate ?? null,
          confidence: item.confidence,
          fieldConfidence: item.field_confidence ?? {},
          raw: item.raw ?? undefined,
        })),
        overallConfidence:
          parsed.items.length > 0
            ? parsed.items.reduce((sum, i) => sum + i.confidence, 0) / parsed.items.length
            : 0,
        notes: parsed.notes ?? [],
        rawPayload: parsed,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildUserPrompt(request: ExtractionRequest): string {
  const parts = [
    `Scan type: ${request.scanType}.`,
    request.businessType ? `Shop type: ${request.businessType}.` : '',
    request.barcodes?.length
      ? `Barcodes already decoded by the camera (trust these over anything you read): ${request.barcodes.join(', ')}.`
      : '',
    request.ocrText ? `Text read by the phone:\n${request.ocrText.slice(0, 4000)}` : '',
    request.knownProductNames?.length
      ? `Products already in this shop (prefer these exact names when they clearly match):\n${request.knownProductNames
          .slice(0, 150)
          .join('\n')}`
      : '',
    `Respond as JSON: {"supplier":string|null,"invoice_number":string|null,"invoice_date":"YYYY-MM-DD"|null,"multiple_documents":boolean,"notes":string[],"items":[{"product_name":string,"quantity":number|null,"unit":string|null,"purchase_price":number|null,"selling_price":number|null,"mrp":number|null,"barcode":string|null,"batch":string|null,"expiry":"YYYY-MM-DD"|null,"tax_rate":number|null,"confidence":number,"field_confidence":{"product_name":number,"quantity":number,"purchase_price":number}}]}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}
