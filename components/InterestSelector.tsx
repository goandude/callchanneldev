import { useState, useRef, useEffect, FC } from 'react';
import { ChevronDown, X } from 'lucide-react';

const INTEREST_OPTIONS = [
  'Movies', 'Music', 'Sports', 'Gaming', 'Travel', 
  'Reading', 'Cooking', 'Art', 'Technology', 'Fashion',
  'Photography', 'Fitness', 'Dancing', 'Writing'
];

interface InterestSelectorProps {
  selectedInterests: string[];
  onChange: (interests: string[]) => void;
}

const InterestSelector: FC<InterestSelectorProps> = ({ selectedInterests, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const toggleInterest = (interest: string) => {
    const newInterests = selectedInterests.includes(interest)
      ? selectedInterests.filter(i => i !== interest)
      : [...selectedInterests, interest];
    onChange(newInterests);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <label className="block text-sm font-medium text-gray-300 mb-1">Interests</label>
      <div 
        className="bg-gray-700 border border-gray-600 rounded-lg p-2 flex flex-wrap gap-2 items-center cursor-pointer min-h-[42px]"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedInterests.length > 0 ? (
          selectedInterests.map(interest => (
            <span key={interest} className="bg-blue-500 text-white text-xs font-semibold px-2 py-1 rounded-full flex items-center gap-1">
              {interest}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleInterest(interest);
                }}
                className="bg-blue-700 hover:bg-blue-800 rounded-full p-0.5"
              >
                <X size={12} />
              </button>
            </span>
          ))
        ) : (
          <span className="text-gray-400 pl-1">Select your interests...</span>
        )}
        <ChevronDown size={16} className="absolute top-9 right-3 text-gray-400" />
      </div>
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {INTEREST_OPTIONS.map(interest => (
            <label
              key={interest}
              className="flex items-center px-4 py-2 hover:bg-gray-700 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedInterests.includes(interest)}
                onChange={() => toggleInterest(interest)}
                className="h-4 w-4 rounded border-gray-500 text-blue-500 focus:ring-blue-500 bg-gray-700"
              />
              <span className="ml-3 text-sm text-gray-200">{interest}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default InterestSelector;