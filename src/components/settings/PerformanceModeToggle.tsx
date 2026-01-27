
import { useState } from 'react';
import { enablePerformanceMode } from '@/native/performanceToggle';

export default function PerformanceModeToggle() {
  const [enabled, setEnabled] = useState(false);

  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async e => {
            setEnabled(e.target.checked);
            await enablePerformanceMode(e.target.checked);
          }}
        />
        Enable Performance Mode (Restart Required)
      </label>
    </div>
  );
}
