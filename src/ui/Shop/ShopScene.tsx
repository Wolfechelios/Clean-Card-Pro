export default function ShopScene({
  children,
}: {
  children?: React.ReactNode
}) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0a0a0d] text-neutral-100">

      {/* Back wall gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-[#111114] to-black" />

      {/* Subtle vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,200,100,0.04),transparent_70%)]" />

      {/* Top lighting glow */}
      <div className="absolute top-0 left-1/2 h-72 w-[900px] -translate-x-1/2 rounded-full bg-amber-400/5 blur-3xl" />

      {/* Floor shadow */}
      <div className="absolute bottom-0 left-0 h-48 w-full bg-gradient-to-t from-black to-transparent" />

      {/* Content layer */}
      <div className="relative z-10 h-full w-full">
        {children}
      </div>
    </div>
  )
}
