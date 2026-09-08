import { spriteDataUrl } from '../game/sprites';

const BADGE_SPRITE: Record<string, string> = {
  mythril: 'badge_mythril',
  diamond: 'badge_diamond',
  gold: 'badge_gold',
  iron: 'badge_iron',
  copper: 'badge_copper',
};

interface Props {
  rank: string;
  showLabel?: boolean;
  size?: number;
}

export default function RankBadge({ rank, showLabel = true, size = 20 }: Props) {
  const sprite = BADGE_SPRITE[rank] ?? 'badge_copper';
  return (
    <span className={`rank-badge rank--${rank}`} title={`Rank: ${rank}`}>
      <img src={spriteDataUrl(sprite)} alt={rank} style={{ width: size, height: size * 0.92 }} />
      {showLabel && <span>{rank}</span>}
    </span>
  );
}
