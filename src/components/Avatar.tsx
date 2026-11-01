const PALETTE = ['#5B8FF9', '#61DDAA', '#F6BD16', '#F6903D', '#7262FD', '#78D3F8', '#9661BC', '#008685'];

export function colorOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function Avatar({
  id,
  text,
  size = 36,
  radius = 6,
}: {
  id: string;
  text: string;
  size?: number;
  radius?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center font-medium text-white select-none"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: id === 'boss' ? '#191919' : id === 'system' ? '#B0B0B0' : colorOf(id),
        fontSize: Math.round(size * 0.42),
      }}
    >
      {text}
    </div>
  );
}
