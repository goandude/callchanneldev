import { FC, useState } from 'react';
import styles from './ConnectionPortal.module.css';

// An array of all your possible GIF paths
const transitionGifs = [
  '/transition/finding1.gif',
  '/transition/finding2.gif',
  '/transition/finding3.gif',
  '/transition/finding4.gif',
  '/transition/finding5.gif',
  '/transition/finding6.gif',
  '/transition/finding7.gif',
];

interface Props {
  statusText: string;
}

const ConnectionPortal: FC<Props> = ({ statusText }) => {
  // Create a state that holds a randomly selected GIF.
  // This function runs only once when the component first renders.
  const [randomGif] = useState(() => {
    const randomIndex = Math.floor(Math.random() * transitionGifs.length);
    return transitionGifs[randomIndex];
  });

  return (
    <div className={styles.portalContainer}>
      {/* Use the 'randomGif' state for the image source */}
      <img src={randomGif} alt="Searching for a partner..." className={styles.gif} />
      <p className={styles.statusText}>{statusText}</p>
    </div>
  );
};

export default ConnectionPortal;