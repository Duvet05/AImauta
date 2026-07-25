import Image from "next/image";

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Image
        className="brand-mark-image"
        src="/brand/amauta-icon.svg"
        alt=""
        width={48}
        height={48}
      />
    </span>
  );
}
