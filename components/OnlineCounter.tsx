import { FC } from 'react';
import { Users } from 'lucide-react';

interface OnlineCounterProps {
  onlineCount: number;
}

const OnlineCounter: FC<OnlineCounterProps> = ({ onlineCount }) => {
  return (
    <div className="absolute top-4 right-4 z-40">
      <div className="flex items-center space-x-2 bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full text-white">
        <Users size={16} className="text-green-400" />
        <span className="font-semibold">{onlineCount}</span>
        <span>Online</span>
      </div>
    </div>
  );
};

export default OnlineCounter;