"use client";

export function EntryPhotoCell({
  imageUrl,
  label,
  onView,
  onAdd,
}: {
  imageUrl?: string;
  label: string;
  onView: (url: string) => void;
  onAdd?: () => void;
}) {
  if (imageUrl) {
    return (
      <button
        type="button"
        className="photo-status has-photo"
        onClick={() => onView(imageUrl)}
        title="ดูรูป"
        aria-label={`ดูรูป ${label}`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.1a2 2 0 0 0 1.5-.7l2.3-2.3a2 2 0 0 1 1.4-.6H16a2 2 0 0 1 1.4.6l2.3 2.3a2 2 0 0 0 1.5.7H21a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      </button>
    );
  }

  if (!onAdd) return null;

  return (
    <button
      type="button"
      className="photo-status"
      onClick={onAdd}
      title="เพิ่มรูป"
      aria-label={`เพิ่มรูป ${label}`}
    >
      <span className="photo-status-plus" aria-hidden>
        +
      </span>
    </button>
  );
}

export function ImagePreviewModal({
  url,
  title,
  onClose,
}: {
  url: string;
  title?: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop photo-backdrop" role="presentation" onClick={onClose}>
      <div className="photo-action-card photo-preview-card" role="dialog" aria-modal="true" aria-label={title || "ดูรูป"} onClick={(e) => e.stopPropagation()}>
        {title ? (
          <p style={{ margin: "0 0 0.55rem", fontWeight: 700, fontSize: "0.92rem", textAlign: "left" }}>
            {title}
          </p>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="photo-preview-full" />
        <button type="button" className="ghost-btn" style={{ width: "100%", marginTop: "0.55rem" }} onClick={onClose}>
          ปิด
        </button>
      </div>
    </div>
  );
}
