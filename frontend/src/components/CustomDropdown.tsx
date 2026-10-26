/**
 * frontend/src/components/CustomDropdown.tsx
 * Modern, styled dropdown menu component with custom scrollbar and active item indicator.
 * Replaces clunky native OS <select> popovers with a clean, branded floating card.
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { PRIMARY_COLOR } from '../theme';

export interface DropdownOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface CustomDropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  labelPrefix?: string;
  icon?: React.ReactNode;
  align?: 'left' | 'right';
  minWidth?: string;
}

export const CustomDropdown: React.FC<CustomDropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  labelPrefix,
  icon,
  align = 'right',
  minWidth = '160px',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Find currently selected item
  const selectedOption = options.find((opt) => opt.value === value);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Scroll to active option when opening
  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.querySelector('[data-selected="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: '#ffffff',
          border: `1px solid ${isOpen ? PRIMARY_COLOR : '#d0d7de'}`,
          borderRadius: '8px',
          padding: '5px 10px 5px 12px',
          boxShadow: isOpen
            ? '0 0 0 3px rgba(20, 137, 55, 0.15)'
            : '0 1px 2px rgba(0, 0, 0, 0.05)',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 600,
          color: '#111827',
          transition: 'all 0.15s ease',
          outline: 'none',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          minWidth,
        }}
      >
        {/* Optional Icon & Prefix */}
        {(icon || labelPrefix) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              paddingRight: '8px',
              borderRight: '1px solid #e5e7eb',
              flexShrink: 0,
            }}
          >
            {icon}
            {labelPrefix && (
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#4b5563',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {labelPrefix}
              </span>
            )}
          </div>
        )}

        {/* Selected Label or Placeholder */}
        <span
          style={{
            flex: 1,
            textAlign: 'left',
            color: selectedOption ? '#111827' : '#6b7280',
            fontWeight: selectedOption ? 600 : 500,
          }}
        >
          {selectedOption ? selectedOption.label : placeholder}
        </span>

        {/* Chevron Indicator */}
        <ChevronDown
          size={14}
          color="#6b7280"
          style={{
            transition: 'transform 0.2s ease',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        />
      </button>

      {/* Floating Dropdown Panel */}
      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 5px)',
            [align === 'right' ? 'right' : 'left']: 0,
            zIndex: 1000,
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
            minWidth: '200px',
            maxWidth: '320px',
            maxHeight: '260px',
            overflowY: 'auto',
            padding: '4px',
            animation: 'dropdownFadeIn 0.15s ease-out',
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                data-selected={isSelected}
                onClick={() => handleSelect(opt.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: isSelected ? 600 : 500,
                  color: isSelected ? PRIMARY_COLOR : '#1f2937',
                  backgroundColor: isSelected ? '#f0fdf4' : 'transparent',
                  transition: 'background-color 0.12s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = '#f3f4f6';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>{opt.label}</span>
                  {opt.sublabel && (
                    <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 400 }}>
                      {opt.sublabel}
                    </span>
                  )}
                </div>

                {isSelected && (
                  <Check size={14} color={PRIMARY_COLOR} style={{ flexShrink: 0, marginLeft: '8px' }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
