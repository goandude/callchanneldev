import { FC } from 'react';
import InterestSelector from './InterestSelector';

interface MatchingPreferences {
  sex: 'male' | 'female' | 'any';
  city: string;
  country: string;
  interests: string[];
}

interface MatchingOptionsBarProps {
  prefs: MatchingPreferences;
  setPrefs: (prefs: MatchingPreferences) => void;
  disabled: boolean;
}

const MatchingOptionsBar: FC<MatchingOptionsBarProps> = ({ prefs, setPrefs, disabled }) => {
  const handleInterestChange = (interests: string[]) => {
    setPrefs({ ...prefs, interests });
  };

  return (
    <div className="w-full max-w-md bg-black/30 backdrop-blur-sm p-4 rounded-xl pointer-events-auto">
      <div className="flex flex-col gap-4">
        {/* Gender Preference */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Partner's Gender</label>
          <div className="flex bg-gray-700 rounded-lg p-1">
            {(['any', 'male', 'female'] as const).map(gender => (
              <button
                key={gender}
                onClick={() => setPrefs({ ...prefs, sex: gender })}
                disabled={disabled}
                className={`flex-1 capitalize text-sm py-1.5 rounded-md transition-colors ${
                  prefs.sex === gender ? 'bg-blue-500 text-white font-semibold' : 'text-gray-300 hover:bg-gray-600'
                }`}
              >
                {gender}
              </button>
            ))}
          </div>
        </div>

        {/* Interest Selector */}
        <InterestSelector 
          selectedInterests={prefs.interests}
          onChange={handleInterestChange}
        />
      </div>
    </div>
  );
};

export default MatchingOptionsBar;