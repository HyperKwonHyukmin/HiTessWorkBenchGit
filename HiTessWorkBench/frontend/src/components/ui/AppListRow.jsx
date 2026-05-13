import React from 'react';
import { motion } from 'framer-motion';
import { Star, ArrowRight, User, Lock } from 'lucide-react';
import Badge from './Badge';

const ACCENT_HOVER = {
  blue:    'hover:border-blue-300 hover:bg-blue-50/40',
  violet:  'hover:border-violet-300 hover:bg-violet-50/40',
  emerald: 'hover:border-emerald-300 hover:bg-emerald-50/40',
  amber:   'hover:border-amber-300 hover:bg-amber-50/40',
};
const ACCENT_TITLE = {
  blue:    'group-hover:text-blue-600',
  violet:  'group-hover:text-violet-600',
  emerald: 'group-hover:text-emerald-600',
  amber:   'group-hover:text-amber-600',
};
const ACCENT_ARROW = {
  blue:    'text-blue-500',
  violet:  'text-violet-500',
  emerald: 'text-emerald-500',
  amber:   'text-amber-500',
};

function DevStatusBadge({ devStatus }) {
  if (!devStatus || devStatus === 'Active') return null;
  if (devStatus === 'Developing') return <Badge variant="warning" size="sm" dot>개발중</Badge>;
  if (devStatus === 'Planned')    return <Badge variant="info"    size="sm" dot>출시 예정</Badge>;
  return null;
}

export default function AppListRow({
  app = {},
  accentColor = 'blue',
  isFavorite  = false,
  isRestricted = false,
  onFavorite,
  onStart,
}) {
  const { title = '', description = '', icon, iconBg = 'bg-blue-100', tags = [], devStatus, contributor } = app;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onStart?.(); }}
      className={[
        'group flex items-center gap-4 bg-white px-5 py-4 rounded-xl',
        'border border-slate-200 shadow-sm cursor-pointer',
        'outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40',
        'transition-colors duration-150',
        ACCENT_HOVER[accentColor] ?? ACCENT_HOVER.blue,
      ].join(' ')}
      whileHover={{ x: 3, boxShadow: '0 4px 20px -4px rgba(0,37,84,0.10)', transition: { type: 'spring', stiffness: 400, damping: 30 } }}
      whileTap={{ scale: 0.995 }}
    >
      {/* 아이콘 */}
      <div className="shrink-0 relative w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center">
        <div className={`absolute inset-0 ${iconBg} opacity-10 group-hover:opacity-20 transition-opacity`} />
        <div className="relative">{icon}</div>
      </div>

      {/* 제목 + 설명 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-bold text-slate-800 transition-colors ${ACCENT_TITLE[accentColor] ?? ACCENT_TITLE.blue}`}>
            {title}
          </span>
          <DevStatusBadge devStatus={devStatus} />
        </div>
        <p className="text-xs text-slate-400 truncate mt-0.5 leading-relaxed">{description}</p>
      </div>

      {/* 태그 */}
      {tags.length > 0 && (
        <div className="hidden lg:flex items-center gap-1.5 shrink-0">
          {tags.slice(0, 3).map((tag, i) => (
            <span key={i} className="text-[10px] font-bold px-2 py-0.5 bg-slate-50 text-slate-400 border border-slate-200 rounded uppercase tracking-wider">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* contributor */}
      {contributor && (
        <div className="hidden xl:flex items-center gap-1 text-xs text-slate-400 shrink-0 whitespace-nowrap">
          <User size={10} />
          <span>{contributor}</span>
        </div>
      )}

      {/* 즐겨찾기 */}
      <motion.button
        type="button"
        onClick={(e) => { e.stopPropagation(); onFavorite?.(); }}
        className="shrink-0 text-slate-300 hover:text-yellow-400 outline-none cursor-pointer"
        whileTap={{ scale: 1.35 }}
        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      >
        <Star size={17} fill={isFavorite ? '#eab308' : 'transparent'} color={isFavorite ? '#eab308' : 'currentColor'} />
      </motion.button>

      {/* 시작 화살표 */}
      <div className={`shrink-0 ${isRestricted ? 'text-slate-300' : ACCENT_ARROW[accentColor] ?? ACCENT_ARROW.blue}`}>
        {isRestricted
          ? <Lock size={15} className="opacity-50" />
          : <ArrowRight size={17} className="group-hover:translate-x-1 transition-transform duration-150" />}
      </div>
    </motion.div>
  );
}
