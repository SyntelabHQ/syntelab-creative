import type { AppHost } from '@syntelab/shell-api';
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { ToolLayout } from '../frame/layout';
import type { ToolActions } from '../frame/text-tool';

/** What a tool is given by the frame it is shown in. */
export interface ToolProps {
  readonly host: AppHost;
  readonly layout: ToolLayout;
  /** Gives the tab what its commands do with the tool; null when the tool goes away. */
  readonly onActions: (actions: ToolActions | null) => void;
}

/**
 * The tools that are built, by their id in the catalog. Each lives in a
 * folder of its own under `tools/` and is loaded when it is first opened. A
 * tool of the catalog that is not here yet is shown with its frame empty.
 */
const BUILT: Readonly<Record<string, LazyExoticComponent<ComponentType<ToolProps>>>> = {
  base64: lazy(() => import('./base64/base64')),
  'url-encode': lazy(() => import('./url-encode/url-encode')),
  'html-entities': lazy(() => import('./html-entities/html-entities')),
  jwt: lazy(() => import('./jwt/jwt')),
  escape: lazy(() => import('./escape/escape')),
  gzip: lazy(() => import('./gzip/gzip')),
  'number-base': lazy(() => import('./number-base/number-base')),
  'json-formatter': lazy(() => import('./json-formatter/json-formatter')),
  jsonpath: lazy(() => import('./jsonpath/jsonpath')),
  'json-schema': lazy(() => import('./json-schema/json-schema')),
  'json-schema-generator': lazy(() => import('./json-schema-generator/json-schema-generator')),
  'json-to-typescript': lazy(() => import('./json-to-typescript/json-to-typescript')),
  'yaml-json': lazy(() => import('./yaml-json/yaml-json')),
  'csv-json': lazy(() => import('./csv-json/csv-json')),
  markup: lazy(() => import('./markup/markup')),
  sql: lazy(() => import('./sql/sql')),
  diff: lazy(() => import('./diff/diff')),
  markdown: lazy(() => import('./markdown/markdown')),
  uuid: lazy(() => import('./uuid/uuid')),
  hash: lazy(() => import('./hash/hash')),
  secrets: lazy(() => import('./secrets/secrets')),
  regex: lazy(() => import('./regex/regex')),
  cron: lazy(() => import('./cron/cron')),
  timestamp: lazy(() => import('./timestamp/timestamp')),
  'url-parser': lazy(() => import('./url-parser/url-parser')),
  certificate: lazy(() => import('./certificate/certificate')),
  hex: lazy(() => import('./hex/hex')),
  keys: lazy(() => import('./keys/keys')),
  http: lazy(() => import('./http/http')),
  dns: lazy(() => import('./dns/dns')),
  port: lazy(() => import('./port/port')),
  'site-certificate': lazy(() => import('./site-certificate/site-certificate')),
};

export const builtTool = (id: string): LazyExoticComponent<ComponentType<ToolProps>> | undefined => BUILT[id];
