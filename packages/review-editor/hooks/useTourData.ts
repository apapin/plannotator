import { useState, useEffect, useCallback, useRef } from 'react';
import { DEMO_TOUR, DEMO_TOUR_ID } from '../demoTour';

// ---------------------------------------------------------------------------
// Types — mirrors packages/server/tour-review.ts
// ---------------------------------------------------------------------------

export interface TourDiffAnchor {
  file: string;
  line: number;
  end_line: number;
  hunk: string;
  label: string;
}

export interface TourKeyTakeaway {
  text: string;
  severity: 'info' | 'important' | 'warning';
}

export interface TourStop {
  title: string;
  gist: string;
  detail: string;
  transition: string;
  anchors: TourDiffAnchor[];
}

export interface TourQAItem {
  question: string;
  stop_indices: number[];
}

export interface CodeTourData {
  title: string;
  greeting: string;
  intent: string;
  before: string;
  after: string;
  key_takeaways: TourKeyTakeaway[];
  stops: TourStop[];
  qa_checklist: TourQAItem[];
  checklist: boolean[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseTourDataReturn {
  tour: CodeTourData | null;
  loading: boolean;
  error: string | null;
  checked: boolean[];
  toggleChecked: (index: number) => void;
  retry: () => void;
}

export function useTourData(jobId: string): UseTourDataReturn {
  const [tour, setTour] = useState<CodeTourData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTour = useCallback(() => {
    if (!jobId) return;
    setLoading(true);
    setError(null);

    // Dev short-circuit: render the demo tour without a backend.
    if (jobId === DEMO_TOUR_ID) {
      setTour(DEMO_TOUR);
      setChecked(new Array(DEMO_TOUR.qa_checklist.length).fill(false));
      setLoading(false);
      return;
    }

    fetch(`/api/tour/${jobId}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Tour not found' : `HTTP ${res.status}`);
        return res.json();
      })
      .then((data: CodeTourData) => {
        setTour(data);
        setChecked(data.checklist?.length > 0 ? data.checklist : new Array(data.qa_checklist.length).fill(false));
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [jobId]);

  useEffect(() => {
    fetchTour();
  }, [fetchTour]);

  const saveChecklist = useCallback(
    (next: boolean[]) => {
      if (jobId === DEMO_TOUR_ID) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        fetch(`/api/tour/${jobId}/checklist`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checked: next }),
        }).catch(() => {});
      }, 500);
    },
    [jobId],
  );

  const toggleChecked = useCallback(
    (index: number) => {
      setChecked((prev) => {
        const next = [...prev];
        next[index] = !next[index];
        saveChecklist(next);
        return next;
      });
    },
    [saveChecklist],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { tour, loading, error, checked, toggleChecked, retry: fetchTour };
}
