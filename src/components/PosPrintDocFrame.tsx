"use client";

/** Embed a thermal print HTML document (same builders as the counter printer). */
export function PosPrintDocFrame({
  html,
  title,
  tall = false,
}: {
  html: string;
  title: string;
  tall?: boolean;
}) {
  return (
    <div className={`pos-print-doc-frame-wrap ${tall ? "is-tall" : ""}`}>
      <div className="pos-print-doc-zigzag" aria-hidden />
      <iframe
        className="pos-print-doc-frame"
        title={title}
        sandbox=""
        srcDoc={html}
      />
    </div>
  );
}

/** Strip auto-print / close scripts so BOH preview does not pop a print dialog. */
export function stripPrintScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}
