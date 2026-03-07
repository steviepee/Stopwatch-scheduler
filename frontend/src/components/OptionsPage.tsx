import { useRef } from 'react';
import { UserOptions } from '../types';

interface OptionsPageProps {
  options: UserOptions;
  onChange: (opts: UserOptions) => void;
}

const BACKGROUND_PRESETS = [
  { label: 'Cloth Mural (default)', value: '/cloth_mural.jpg' },
  { label: 'None (solid dark)', value: null },
];

export default function OptionsPage({ options, onChange }: OptionsPageProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (key: keyof Pick<UserOptions, 'showAverage' | 'showMedian' | 'showPrevious'>) => {
    onChange({ ...options, [key]: !options[key] });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onChange({ ...options, backgroundImage: url });
  };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-8 max-w-xl">
      <h2 className="text-xl font-bold text-white">Options</h2>

      {/* Duration metrics */}
      <section className="space-y-3">
        <h3 className="text-white/60 text-xs uppercase tracking-wider">Duration Metrics</h3>
        <p className="text-white/50 text-xs">
          Choose which metrics appear when adding activities to a schedule. The first enabled metric (Previous → Median → Average) is used to pre-fill the estimated duration.
        </p>
        <div className="space-y-2">
          {[
            { key: 'showAverage' as const, label: 'Average', description: 'Mean across all recordings' },
            { key: 'showMedian' as const, label: 'Median', description: 'Middle value of all recordings' },
            { key: 'showPrevious' as const, label: 'Previous', description: 'Duration from your last recording' },
          ].map(({ key, label, description }) => (
            <label
              key={key}
              className="flex items-center gap-3 cursor-pointer glass-inner rounded-xl px-4 py-3"
            >
              <input
                type="checkbox"
                checked={options[key]}
                onChange={() => toggle(key)}
                className="w-4 h-4 rounded accent-emerald-400"
              />
              <div>
                <div className="text-white text-sm font-medium">{label}</div>
                <div className="text-white/50 text-xs">{description}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Background image */}
      <section className="space-y-3">
        <h3 className="text-white/60 text-xs uppercase tracking-wider">Background Image</h3>
        <div className="space-y-2">
          {BACKGROUND_PRESETS.map(preset => (
            <label
              key={preset.label}
              className="flex items-center gap-3 cursor-pointer glass-inner rounded-xl px-4 py-3"
            >
              <input
                type="radio"
                name="bg"
                checked={options.backgroundImage === preset.value}
                onChange={() => onChange({ ...options, backgroundImage: preset.value })}
                className="accent-emerald-400"
              />
              <span className="text-white text-sm">{preset.label}</span>
            </label>
          ))}

          <label className="flex items-center gap-3 cursor-pointer glass-inner rounded-xl px-4 py-3">
            <input
              type="radio"
              name="bg"
              checked={
                options.backgroundImage !== null &&
                !BACKGROUND_PRESETS.some(p => p.value === options.backgroundImage)
              }
              onChange={() => fileRef.current?.click()}
              className="accent-emerald-400"
            />
            <span className="text-white text-sm">Custom image</span>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="ml-auto glass-button px-3 py-1 rounded-lg text-xs"
            >
              Upload
            </button>
          </label>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />

          {options.backgroundImage &&
            !BACKGROUND_PRESETS.some(p => p.value === options.backgroundImage) && (
              <div className="px-4">
                <img
                  src={options.backgroundImage}
                  alt="Preview"
                  className="w-full h-24 object-cover rounded-xl opacity-70"
                />
              </div>
            )}
        </div>
      </section>
    </div>
  );
}
