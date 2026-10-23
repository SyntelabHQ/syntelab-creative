import { useTranslation } from '@syntelab/i18n';
import { InspectTool, readIndent } from '../inspect-tool';
import type { ToolProps } from '../registry';
import { stored, useOptions } from '../use-options';

/**
 * X.509 certificates read, from PEM (as many as a paste holds) or from a
 * file in DER: subject, issuer, validity, serial, key, signature algorithm,
 * alternative names, usages, where their status is asked, extensions and
 * fingerprints. They are read, not judged: whether a certificate is to be
 * trusted is not checked, and nothing is fetched.
 */
export default function Certificate(props: ToolProps) {
  const t = useTranslation();
  const [options, change] = useOptions(props.host, 'certificate.options', (value) => ({ indent: readIndent(stored(value).indent) }));

  return (
    <InspectTool
      {...props}
      tool="certificate"
      indent={options.indent}
      onIndent={(indent) => change({ indent })}
      takesBytes
      resultFits
      opens={{ typeName: t('dev.certificate.files'), extensions: ['pem', 'crt', 'cer', 'der', 'txt'] }}
      mark="certificate"
      fine={t('dev.certificate.fine')}
      workTitle={t('dev.certificate.working')}
    />
  );
}
