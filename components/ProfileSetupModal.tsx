import { FC, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { User } from '@supabase/supabase-js';
const interestsOptions = ["🎨 Artists", "🎮 Gamers", "📚 Students", "🎵 Music Lovers"];

interface ProfileSetupModalProps {
  user: User;
  onComplete: () => void;
}

const ProfileSetupModal: FC<ProfileSetupModalProps> = ({ user, onComplete }) => {
  const [sex, setSex] = useState('Male');
  const [city, setCity] = useState('San Francisco');
  const [country, setCountry] = useState('USA');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [age, setAge] = useState<number | ''>('');
  const [interests, setInterests] = useState<string[]>([]);
  const handleSaveProfile = async () => {
    if (Number(age) < 13) {
      setError('You must be at least 13 years old to use this service.');
      return;
    }
    if (!sex || !city || !country) {
      setError('Please fill out all fields.');
      return;
    }
    setLoading(true);
    setError('');

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        age,
        sex,
        interests,
        city,
        country,
        is_profile_complete: true,
      })
      .eq('id', user.id);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
    } else {
      onComplete();
    }
    
  };
  const handleInterestChange = (interest: string) => {
  setInterests((prev) =>
    prev.includes(interest)
      ? prev.filter((i) => i !== interest)
      : [...prev, interest].slice(0, 3)
  );
  };

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-white text-black p-8 rounded-lg shadow-xl w-full max-w-md">
        <h2 className="text-2xl font-bold mb-4">Complete Your Profile</h2>
        <p className="mb-6 text-gray-600">Please provide a few details to start matching.</p>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Sex</label>
            <select
              value={sex}
              onChange={(e) => setSex(e.target.value)}
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
            >
              <option value="" disabled>Select...</option>
              <option value="male" selected>Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Enter City"
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Country</label>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Enter Country"
              className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
        <label className="block text-sm font-medium text-gray-700">Age</label>
        <input
          type="number"
          min={13}
          value={age}
          onChange={(e) => setAge(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="Enter your age"
          className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
        />
      </div>
        </div>
        <div>
      <label className="block text-sm font-medium text-gray-700">Your Interests (up to 3)</label>
      <div className="mt-2 flex flex-wrap gap-2">
        {interestsOptions.map(interest => (
          <button
            key={interest}
            onClick={() => handleInterestChange(interest)}
            className={`px-3 py-1 rounded-full text-sm font-semibold border-2 ${
              interests.includes(interest)
                ? 'bg-blue-500 text-white border-blue-500'
                : 'bg-white text-gray-700 border-gray-300'
            }`}
          >
            {interest}
          </button>
        ))}
      </div>
    </div>
        {error && <p className="text-red-500 text-sm mt-4">{error}</p>}

        <button
          onClick={handleSaveProfile}
          disabled={loading}
          className="w-full bg-blue-500 text-white font-bold py-3 px-4 rounded-md mt-6 hover:bg-blue-600 disabled:bg-blue-300"
        >
          {loading ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
};

export default ProfileSetupModal;