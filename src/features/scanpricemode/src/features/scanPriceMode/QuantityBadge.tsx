export function QuantityBadge({ qty }: { qty: number }) {
  if (qty <= 1) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        background: 'black',
        color: 'white',
        borderRadius: '999px',
        padding: '2px 6px',
        fontSize: 12,
      }}
    >
      ×{qty}
    </div>
  )
}
