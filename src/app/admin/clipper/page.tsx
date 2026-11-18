import Clipper from './Clipper';

export default function ClipperPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">Video Clipper</h1>
      <p className="text-stone-600 mt-1">
        Cut a clip from a video, add subtitles, crop it for Reels / TikTok, and download it.
        Everything runs in your browser — the video is never uploaded.
      </p>
      <div className="mt-6">
        <Clipper />
      </div>
    </div>
  );
}
