import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';

/** Groups the code in fours for people; the bars always encode the compact code. */
export const formatBoardingCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1 ');

/**
 * Code 128 rendering of a personal boarding code. Scanners need dark bars on a white
 * background with a quiet zone, so the barcode keeps its own white panel and margin.
 */
export function BoardingBarcode({ code, height = 96 }: { code: string; height?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svgRef.current) return;
    JsBarcode(svgRef.current, code, {
      format: 'CODE128',
      height,
      width: 2,
      margin: 14,
      background: '#ffffff',
      lineColor: '#0d2d28',
      displayValue: true,
      text: formatBoardingCode(code),
      font: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 15,
      textMargin: 6,
    });
  }, [code, height]);
  return <svg aria-label={`Boarding barcode ${formatBoardingCode(code)}`} className="boarding-barcode" ref={svgRef} role="img" />;
}
