
import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarAlt } from '@fortawesome/free-solid-svg-icons';
import { toInputDate } from '../../../utils/dateUtils';

interface DatePickerProps {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    className?: string;
    placeholder?: string;
    required?: boolean;
}

export const DatePicker: React.FC<DatePickerProps> = ({ value, onChange, className = '', placeholder = 'dd/mm/yyyy', required }) => {

    // helper function replaced by toInputDate

    // Formats a YYYY-MM-DD or full ISO string into DD/MM/YYYY for user-friendly display.
    const formatDateForDisplay = (isoDate: string) => {
        const datePart = toInputDate(isoDate);
        if (!datePart) return '';
        const [year, month, day] = datePart.split('-');
        if (year && month && day) {
            return `${day}/${month}/${year}`;
        }
        return placeholder; // Fallback
    };

    const handleClick = (e: React.MouseEvent<HTMLInputElement>) => {
        const input = e.currentTarget;
        // Try using the modern showPicker() API for better UX
        if ('showPicker' in input) {
            try {
                (input as any).showPicker();
            } catch (error) {
                // Fallback or ignore if blocked by browser
            }
        }
    };

    return (
        <div className="relative w-full">
            {/* CSS Hack to make the entire visible area clickable to trigger the date picker */}
            <style>{`
        .custom-date-input::-webkit-calendar-picker-indicator {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: auto;
          height: auto;
          color: transparent;
          background: transparent;
          cursor: pointer;
        }
      `}</style>

            {/* This is the visible, styled part of the input */}
            <div className={`flex items-center justify-between ${className} pointer-events-none select-none`}>
                <span className={`truncate ${!value ? 'text-slate-400' : 'text-inherit'}`}>
                    {value ? formatDateForDisplay(value) : placeholder}
                </span>
                <FontAwesomeIcon icon={faCalendarAlt} className="text-slate-400 flex-shrink-0 ml-2" />
            </div>

            {/* This is the actual, hidden date input that provides functionality */}
            <input
                type="date"
                required={required}
                value={toInputDate(value)} // Use the correctly formatted date part
                onChange={onChange}
                onClick={handleClick}
                className="custom-date-input absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
        </div>
    );
};