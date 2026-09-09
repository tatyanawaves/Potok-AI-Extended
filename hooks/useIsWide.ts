import { useEffect, useState } from 'react';

/** Tailwind's `md` breakpoint, where the multi-column layouts start to fit. */
export const WIDE_QUERY = '(min-width: 768px)';

/**
 * Whether there is room for the side-by-side layout.
 *
 * Only for behaviour that CSS cannot express — chiefly "select the first board
 * automatically", which is helpful on a wide screen and makes the back button
 * useless on a narrow one, because the list you just returned to would pick
 * something again. Appearance stays in the classes.
 */
export const useIsWide = (): boolean => {
    const [wide, setWide] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches
    );

    useEffect(() => {
        const query = window.matchMedia(WIDE_QUERY);
        const update = () => setWide(query.matches);

        update();
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);

    return wide;
};
