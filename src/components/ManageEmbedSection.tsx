"use client";

import type { ReactNode } from "react";

/** Slim sub-block inside a consolidated manage fold (no nested SettingsFold). */
export function ManageEmbedSection({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="npos-manage-embed">
      <h4 className="npos-manage-embed-head">{title}</h4>
      {hint ? <p className="muted npos-manage-embed-hint">{hint}</p> : null}
      <div className="npos-manage-embed-body">{children}</div>
    </section>
  );
}
