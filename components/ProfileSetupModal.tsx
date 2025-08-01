import { useState, FC } from 'react';
import { supabase } from '../lib/supabaseClient';
import { User } from '@supabase/supabase-js';
import InterestSelector from './InterestSelector';

interface Profile { id: string; is_profile_complete: boolean; nickname: string; [key: string]: any; }

interface ProfileSetupModalProps {
  user: User;
  profile: Profile;
  onComplete: () => void;
}

const ProfileSetupModal: FC<ProfileSetupModalProps> = ({ user, profile, onComplete }) => {
  const [nickname, setNickname] = useState(profile?.nickname || `User${Math.floor(1000 + Math.random() * 9000)}`);
  const [age, setAge] = useState(profile?.age || '');
  const [sex, setSex] = useState<'male' | 'female' | 'any'>(profile?.sex || 'male');
  const [city, setCity] = useState(profile?.city || 'New York');
  const [country, setCountry] = useState(profile?.country || 'USA');
  const [selectedInterests, setSelectedInterests] = useState<string[]>(profile?.interests || ['Music']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!nickname.trim()) {
      setError('Nickname is required.');
      return;
    }
    if (!age || Number(age) < 13) {
      setError('You must be at least 13 years old.');
      return;
    }
    if (!city.trim() || !country.trim()) {
      setError('Please provide your city and country.');
      return;
    }
    if (selectedInterests.length === 0) {
      setError('Please select at least one interest.');
      return;
    }

    setLoading(true);
    setError(null);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        nickname: nickname,
        sex: sex,
        age: Number(age),
        city,
        country,
        interests: selectedInterests,
        is_profile_complete: true,
      })
      .eq('id', user.id);

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
      <div className="bg-gray-800 text-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <h2 className="text-2xl font-bold mb-4">Complete Your Profile</h2>
        <p className="text-gray-400 mb-6">Let's get you set up for matching.</p>
        
        <div className="space-y-6">
          <div>
            <label htmlFor="nickname" className="block text-sm font-medium text-gray-300 mb-1">
              Nickname
            </label>
            <input
              id="nickname"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., Alex"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="age" className="block text-sm font-medium text-gray-300 mb-1">
                Age
              </label>
              <input
                id="age"
                type="number"
                min={13}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 25"
              />
            </div>
            <div>
              <label htmlFor="sex" className="block text-sm font-medium text-gray-300 mb-1">
                Gender
              </label>
              <select
                id="sex"
                value={sex}
                onChange={(e) => setSex(e.target.value as 'male' | 'female' | 'any')}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500 h-[42px]"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="any">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="city" className="block text-sm font-medium text-gray-300 mb-1">
              City
            </label>
            <input id="city" type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g., New York" />
          </div>

          <div>
            <label htmlFor="country" className="block text-sm font-medium text-gray-300 mb-1">
              Country
            </label>
            <input id="country" type="text" value={country} onChange={(e) => setCountry(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g., USA" />
          </div>

          <InterestSelector 
            selectedInterests={selectedInterests}
            onChange={setSelectedInterests}
          />
        </div>

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}

        <div className="mt-8">
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg transition-colors"
          >
            {loading ? 'Saving...' : 'Save and Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};


export default ProfileSetupModal;