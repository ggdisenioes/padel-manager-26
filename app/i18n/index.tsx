"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { Locale } from "./types";

import es from "./locales/es.json";
import en from "./locales/en.json";

const dictionaries: Record<Locale, Record<string, unknown>> = { es, en };

const STORAGE_KEY = "padelx-locale";
const DEFAULT_LOCALE: Locale = "es";

type I18nContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextType | null>(null);

function flattenStrings(
  obj: Record<string, unknown>,
  out: Record<string, string>,
  prefix = ""
) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[full] = value;
      continue;
    }
    if (value && typeof value === "object") {
      flattenStrings(value as Record<string, unknown>, out, full);
    }
  }
}

function translatePreservingWhitespace(
  input: string,
  map: Map<string, string>,
  entries: Array<[string, string]>
): string {
  const exact = map.get(input);
  if (exact !== undefined) return exact;

  // Fallback: replace known dictionary phrases inside longer strings
  // e.g. "🎯 Cargar resultados" -> "🎯 Load results"
  let partial = input;
  let changed = false;
  for (const [from, to] of entries) {
    if (from.length < 4) continue;
    if (!partial.includes(from)) continue;
    partial = partial.split(from).join(to);
    changed = true;
  }
  if (changed) return partial;

  const trimmed = input.trim();
  if (!trimmed) return input;
  const translated = map.get(trimmed);
  if (translated === undefined) return input;

  const leading = input.match(/^\s*/)?.[0] ?? "";
  const trailing = input.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}

function getNestedValue(
  obj: Record<string, unknown>,
  path: string
): string | undefined {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

function getInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "es" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [mounted, setMounted] = useState(false);
  const originalTextRef = useRef(new WeakMap<Text, string>());
  const originalAttrsRef = useRef(new WeakMap<Element, Record<string, string>>());
  const applyingRef = useRef(false);

  const domTranslationMap = useMemo(() => {
    const esFlat: Record<string, string> = {};
    const enFlat: Record<string, string> = {};
    flattenStrings(es as Record<string, unknown>, esFlat);
    flattenStrings(en as Record<string, unknown>, enFlat);

    const map = new Map<string, string>();
    for (const [key, esValue] of Object.entries(esFlat)) {
      const enValue = enFlat[key];
      if (!enValue || esValue === enValue) continue;
      map.set(esValue, enValue);
    }
    const entries = Array.from(map.entries()).sort(
      (a, b) => b[0].length - a[0].length
    );
    return { map, entries };
  }, []);

  useEffect(() => {
    setLocaleState(getInitialLocale());
    setMounted(true);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = newLocale;
  }, []);

  useEffect(() => {
    if (!mounted || typeof document === "undefined") return;

    const translatableAttrs = ["placeholder", "title", "aria-label", "value"];
    const excludedParents = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE"]);

    const applyDomTranslation = () => {
      if (applyingRef.current) return;
      applyingRef.current = true;
      try {
        const textWalker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              if (excludedParents.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
              if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            },
          }
        );

        let current = textWalker.nextNode();
        while (current) {
          const textNode = current as Text;
          if (!originalTextRef.current.has(textNode)) {
            originalTextRef.current.set(textNode, textNode.nodeValue ?? "");
          }
          const original = originalTextRef.current.get(textNode) ?? "";
          const nextValue =
            locale === "en"
              ? translatePreservingWhitespace(
                  original,
                  domTranslationMap.map,
                  domTranslationMap.entries
                )
              : original;
          if (textNode.nodeValue !== nextValue) {
            textNode.nodeValue = nextValue;
          }
          current = textWalker.nextNode();
        }

        const selector = translatableAttrs.map((attr) => `[${attr}]`).join(",");
        const elements = document.querySelectorAll<HTMLElement>(selector);
        elements.forEach((el) => {
          if (!originalAttrsRef.current.has(el)) {
            originalAttrsRef.current.set(el, {});
          }
          const attrStore = originalAttrsRef.current.get(el)!;
          translatableAttrs.forEach((attr) => {
            const currentValue = el.getAttribute(attr);
            if (currentValue == null) return;
            if (attrStore[attr] === undefined) {
              attrStore[attr] = currentValue;
            }
            const original = attrStore[attr];
            const nextValue =
              locale === "en"
                ? translatePreservingWhitespace(
                    original,
                    domTranslationMap.map,
                    domTranslationMap.entries
                  )
                : original;
            if (currentValue !== nextValue) {
              el.setAttribute(attr, nextValue);
            }
          });
        });
      } finally {
        applyingRef.current = false;
      }
    };

    applyDomTranslation();

    const observer = new MutationObserver(() => applyDomTranslation());
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatableAttrs,
    });

    return () => observer.disconnect();
  }, [locale, mounted, domTranslationMap]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
      let value = getNestedValue(dict as Record<string, unknown>, key);

      // Fallback to Spanish if key missing in current locale
      if (value === undefined && locale !== DEFAULT_LOCALE) {
        value = getNestedValue(
          dictionaries[DEFAULT_LOCALE] as Record<string, unknown>,
          key
        );
      }

      // Fallback to key itself if not found anywhere
      if (value === undefined) return key;

      // Simple parameter interpolation: "Hello {{name}}" -> "Hello World"
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(
            new RegExp(`\\{\\{${k}\\}\\}`, "g"),
            String(v)
          );
        }
      }

      return value;
    },
    [locale]
  );

  // Avoid hydration mismatch: render with default locale until mounted
  if (!mounted) {
    const defaultT = (key: string, params?: Record<string, string | number>) => {
      let value =
        getNestedValue(
          dictionaries[DEFAULT_LOCALE] as Record<string, unknown>,
          key
        ) ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(
            new RegExp(`\\{\\{${k}\\}\\}`, "g"),
            String(v)
          );
        }
      }
      return value;
    };
    return (
      <I18nContext.Provider value={{ locale: DEFAULT_LOCALE, setLocale, t: defaultT }}>
        {children}
      </I18nContext.Provider>
    );
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx)
    throw new Error("useTranslation must be used inside <LanguageProvider>");
  return ctx;
}
