import Image from "next/image";

export function FooterQuipus() {
  return (
    <div className="footer-quipus" aria-hidden="true">
      <Image
        src="/svg/quipu.svg"
        alt=""
        width={743}
        height={923}
        sizes="(max-width: 680px) 100px, 136px"
        unoptimized
      />
      <Image
        src="/svg/quipu.svg"
        alt=""
        width={743}
        height={923}
        sizes="(max-width: 680px) 100px, 136px"
        unoptimized
      />
    </div>
  );
}
