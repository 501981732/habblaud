import type { MessageRef } from './types';

/** Explicit product copy. Callers must never wrap user or model text without a fixed template. */
export interface ProductCopy {
  text: string;
  i18n: MessageRef;
}

export function productCopy(key: string, params?: Record<string, string | number>): ProductCopy {
  const text = key.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name: string) =>
    params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
  return { text, i18n: params ? { key, params } : { key } };
}
