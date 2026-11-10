import MobileDashboardPreview from "./MobileDashboardPreview";

export default function PhoneMockup() {
  return (
    <div
      role="group"
      aria-label="Illustrative Disburse mobile dashboard preview"
      className="anim-enter anim-float relative z-10 rounded-[2.55rem] border border-[#d6d4cc] bg-[#282b28] p-[7px] shadow-[0_30px_70px_rgba(36,39,34,0.17)]"
      style={{ animationDelay: "180ms" }}
    >
      <div className="relative overflow-hidden rounded-[2.1rem] bg-[#f8f7f3]">
        <div aria-hidden="true" className="absolute left-1/2 top-[7px] z-10 h-[13px] w-[74px] -translate-x-1/2 rounded-full bg-[#282b28]" />
        <div className="px-[7px] pb-[7px] pt-[25px]">
          <MobileDashboardPreview />
        </div>
      </div>
    </div>
  );
}
