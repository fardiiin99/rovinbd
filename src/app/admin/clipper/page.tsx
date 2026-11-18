import Clipper from './Clipper';

export default function ClipperPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Video Clipper</h1>
      <p className="text-stone-600 mt-1">
        Drop in a long video and get short, captioned clips for Reels, TikTok and Shorts. Pick how many
        clips and how long; it finds the best moments and writes the captions from the speech.
        Everything runs in your browser, so the video is never uploaded.
      </p>
      <div className="mt-6">
        <Clipper />
      </div>
    </div>
  );
}
