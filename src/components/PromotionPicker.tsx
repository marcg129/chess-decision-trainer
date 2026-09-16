export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

const choices: Array<{ piece: PromotionPiece; label: string }> = [
  { piece: 'q', label: 'Queen' },
  { piece: 'r', label: 'Rook' },
  { piece: 'b', label: 'Bishop' },
  { piece: 'n', label: 'Knight' },
];

export function PromotionPicker({
  onChoose,
  onCancel,
}: {
  onChoose: (piece: PromotionPiece) => void;
  onCancel: () => void;
}) {
  return (
    <div className="promotion-backdrop">
      <div
        className="promotion-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Choose promotion piece"
      >
        <p>Choose promotion piece</p>
        <div className="promotion-options">
          {choices.map(({ piece, label }) => (
            <button type="button" key={piece} onClick={() => onChoose(piece)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
