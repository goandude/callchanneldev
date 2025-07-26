import { FC, Dispatch, SetStateAction } from 'react';

// Define the shape of the preferences object
interface MatchingPreferences {
  sex: 'male' | 'female' | 'any';
  city: string;
  country: string;
  interests: string[];

}

interface MatchingOptionsBarProps {
 prefs: MatchingPreferences;
 setPrefs: Dispatch<SetStateAction<MatchingPreferences>>;
 disabled: boolean;
}
const interestFilters = ["🎨 Artists", "🎮 Gamers", "📚 Students", "🎵 Music Lovers"];

const MatchingOptionsBar: FC<MatchingOptionsBarProps> = ({ prefs, setPrefs, disabled }) => {
  const handleInterestChange = (interest: string) => {
    setPrefs({
      ...prefs,
      interests: prefs.interests.includes(interest)
        ? prefs.interests.filter(i => i !== interest)
        : [...prefs.interests, interest].slice(0, 3)
    });
  };
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-gray-800/50 backdrop-blur-sm rounded-lg pointer-events-auto">
      <span className="font-semibold text-white">Match with:</span>
      <div>
      <label>Interests:</label>
      <div className="flex flex-wrap gap-2 mt-1">
        {interestFilters.map(interest => (
          <button
            key={interest}
            disabled={disabled}
            onClick={() => handleInterestChange(interest)}
            className={`px-3 py-1 ... ${prefs.interests.includes(interest) ? 'bg-blue-500' : 'bg-gray-700'}`}
          >
            {interest}
          </button>
        ))}
      </div>
    </div>
      <div className="flex items-center gap-4">
        {/* Sex Preference */}
        <select
          value={prefs.sex}
          onChange={(e) => setPrefs({ ...prefs, sex: e.target.value as MatchingPreferences['sex'] })}
          disabled={disabled}
          className="bg-gray-700 text-white border-gray-600 rounded-md p-2"
        >
          <option value="any">Any Sex</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
        
        {/* Location Preference can be added here if desired */}
        {/* For simplicity, we'll start with just sex preference */}
      </div>
    </div>
  );
};

export default MatchingOptionsBar;