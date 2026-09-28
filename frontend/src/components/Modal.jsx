import { useEffect } from "react";

/** Modal ligero y reutilizable. Reemplaza los window.prompt/confirm del
 * navegador por un diálogo propio, más claro y fácil de usar. Cierra con
 * Escape o al hacer clic fuera de la tarjeta. */
export default function Modal({ title, description, children, onClose, actions }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop modal" onMouseDown={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        {description && <p className="modal-desc">{description}</p>}
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
