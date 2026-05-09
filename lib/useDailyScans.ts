// lib/useDailyScans.ts
import { useState, useEffect } from 'react';

export function useDailyScans() {
    const [scansToday, setScansToday] = useState(0);

    useEffect(() => {
        // This only runs on the client browser, safely avoiding Next.js SSR mismatch errors
        const today = new Date().toDateString(); // e.g., "Sun May 10 2026"
        const storedDate = localStorage.getItem('allyflow_scan_date');
        const storedScans = localStorage.getItem('allyflow_scan_count');

        if (storedDate === today && storedScans) {
            // It's still today, load the saved number!
            setScansToday(parseInt(storedScans, 10));
        } else {
            // It's a new day (or their very first visit). Reset to 0.
            localStorage.setItem('allyflow_scan_date', today);
            localStorage.setItem('allyflow_scan_count', '0');
            setScansToday(0);
        }
    }, []);

    // Function to call whenever a scan successfully finishes
    const incrementScans = () => {
        const today = new Date().toDateString();
        setScansToday((prev) => {
            const newValue = prev + 1;
            localStorage.setItem('allyflow_scan_date', today);
            localStorage.setItem('allyflow_scan_count', newValue.toString());
            return newValue;
        });
    };

    return { scansToday, incrementScans };
}