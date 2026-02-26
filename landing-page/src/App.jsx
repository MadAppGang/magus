import { useState, useEffect, useRef, useCallback } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Download, Terminal, ArrowRight, Zap, Shield, GitBranch, ChevronDown, ExternalLink, Code2, Search, Server, Layers, Bot, Palette, Video, Image, BarChart3, Settings, Mail, Workflow } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

/* ═══════════════════════════════════════════
   A. NAVBAR — "The Floating Island"
   ═══════════════════════════════════════════ */
function Navbar() {
    const [scrolled, setScrolled] = useState(false);
    const navRef = useRef(null);

    useEffect(() => {
        const hero = document.getElementById('hero');
        if (!hero) return;

        const observer = new IntersectionObserver(
            ([entry]) => setScrolled(!entry.isIntersecting),
            { threshold: 0.1 }
        );
        observer.observe(hero);
        return () => observer.disconnect();
    }, []);

    const scrollTo = (id) => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <nav
            ref={navRef}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-2 py-2 rounded-full transition-all duration-500 ease-out flex items-center gap-1 md:gap-4 ${scrolled
                ? 'bg-offwhite/70 backdrop-blur-xl border border-paper shadow-lg'
                : 'bg-transparent border border-transparent'
                }`}
        >
            <a href="#" className="font-heading font-bold text-sm md:text-base tracking-brutal px-4">
                <span className={scrolled ? 'text-ink' : 'text-offwhite'}>MAD</span>
                <span className={scrolled ? 'text-signal' : 'text-signal'}> Code</span>
            </a>

            <div className="hidden md:flex items-center gap-1">
                {['features', 'plugins', 'protocol', 'pricing'].map((s) => (
                    <button
                        key={s}
                        onClick={() => scrollTo(s)}
                        className={`px-3 py-1.5 text-xs font-heading font-medium tracking-tight rounded-full lift-hover transition-colors ${scrolled ? 'text-ink/70 hover:text-ink hover:bg-paper/50' : 'text-offwhite/70 hover:text-offwhite'
                            }`}
                    >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                ))}
            </div>

            <button
                onClick={() => scrollTo('download')}
                className={`btn-magnetic ml-2 px-4 py-2 rounded-full text-xs font-heading font-semibold tracking-tight ${scrolled
                    ? 'bg-signal text-offwhite'
                    : 'bg-offwhite/10 text-offwhite border border-offwhite/20'
                    }`}
            >
                <span className="btn-bg bg-ink"></span>
                <span>Get MAD Code</span>
            </button>
        </nav>
    );
}

/* ═══════════════════════════════════════════
   B. HERO — "The Opening Shot"
   ═══════════════════════════════════════════ */
function Hero() {
    const heroRef = useRef(null);
    const contentRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
            tl.fromTo('.hero-line-1', { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 1.0 })
                .fromTo('.hero-line-2', { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 1.0 }, '-=0.7')
                .fromTo('.hero-sub', { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, '-=0.5')
                .fromTo('.hero-cta', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, '-=0.4')
                .fromTo('.hero-scroll', { opacity: 0 }, { opacity: 1, duration: 0.6 }, '-=0.2');
        }, heroRef);
        return () => ctx.revert();
    }, []);

    return (
        <section
            id="hero"
            ref={heroRef}
            className="relative h-[100dvh] w-full overflow-hidden"
        >
            {/* Background */}
            <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                style={{
                    backgroundImage: `url('https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=1920&q=80')`,
                }}
            />
            <div className="absolute inset-0 hero-gradient" />

            {/* Content — bottom-left aligned */}
            <div
                ref={contentRef}
                className="relative z-10 h-full flex flex-col justify-end px-6 md:px-16 lg:px-24 pb-16 md:pb-24 max-w-6xl"
            >
                <h1 className="mb-4">
                    <span className="hero-line-1 block font-heading font-bold text-offwhite text-3xl md:text-5xl lg:text-6xl tracking-brutal leading-none">
                        Command the
                    </span>
                    <span className="hero-line-2 block font-drama italic text-signal text-6xl md:text-[8rem] lg:text-[10rem] leading-[0.9] mt-2">
                        System.
                    </span>
                </h1>

                <p className="hero-sub font-mono text-offwhite/60 text-xs md:text-sm tracking-wide max-w-lg mb-8">
                    50 agents. One terminal. Zero drift.<br />
                    Production-grade AI orchestration, not another demo.
                </p>

                <div className="hero-cta flex flex-wrap gap-3">
                    <a
                        href="#download"
                        className="btn-magnetic inline-flex items-center gap-2 bg-signal text-offwhite px-6 py-3 rounded-full font-heading font-semibold text-sm tracking-tight"
                    >
                        <span className="btn-bg bg-ink"></span>
                        <Download size={16} />
                        <span>Download MAD Code</span>
                    </a>
                    <a
                        href="#protocol"
                        className="btn-magnetic inline-flex items-center gap-2 bg-transparent border border-offwhite/20 text-offwhite px-6 py-3 rounded-full font-heading font-medium text-sm tracking-tight"
                    >
                        <span className="btn-bg bg-offwhite/10"></span>
                        <span>See How It Works</span>
                        <ArrowRight size={14} />
                    </a>
                </div>

                <div className="hero-scroll absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-offwhite/30">
                    <span className="font-mono text-[10px] tracking-widest uppercase">Scroll</span>
                    <ChevronDown size={14} className="animate-bounce" />
                </div>
            </div>
        </section>
    );
}

/* ═══════════════════════════════════════════
   C. FEATURES — Interactive Functional Artifacts
   ═══════════════════════════════════════════ */

/* Card 1 — Diagnostic Shuffler */
function ShufflerCard() {
    const [stack, setStack] = useState([
        { label: 'Spawn Agent', color: 'bg-signal/10 border-signal/30' },
        { label: 'Route Task', color: 'bg-ink/5 border-ink/10' },
        { label: 'Scale Fleet', color: 'bg-paper border-ink/10' },
    ]);

    useEffect(() => {
        const interval = setInterval(() => {
            setStack((prev) => {
                const next = [...prev];
                next.unshift(next.pop());
                return next;
            });
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="card-container p-6 md:p-8 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-2">
                <Zap size={16} className="text-signal" />
                <span className="font-mono text-[10px] text-mid tracking-widest uppercase">Scale</span>
            </div>
            <h3 className="font-heading font-bold text-lg md:text-xl tracking-brutal text-ink mb-1">
                Your AI Army
            </h3>
            <p className="font-heading text-sm text-ink/50 mb-6">
                50 Agents. One Command.
            </p>

            <div className="relative flex-1 min-h-[160px]">
                {stack.map((card, i) => (
                    <div
                        key={card.label}
                        className={`absolute left-0 right-0 ${card.color} border rounded-2xl px-5 py-4 font-mono text-sm text-ink/80 shadow-sm`}
                        style={{
                            top: `${i * 16}px`,
                            zIndex: 3 - i,
                            opacity: 1 - i * 0.2,
                            transform: `scale(${1 - i * 0.04})`,
                            transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        }}
                    >
                        <span className="text-signal font-bold mr-2">▸</span>
                        {card.label}
                    </div>
                ))}
            </div>
        </div>
    );
}

/* Card 2 — Telemetry Typewriter */
function TypewriterCard() {
    const messages = [
        '> deploying agent-fleet v2.4.1...',
        '✓ 48/50 agents operational',
        '> stress-test: 10k requests — pass',
        '✓ zero regression detected',
        '> build: production bundle ready',
        '✓ shipped to registry in 3.2s',
        '> rollback safeguard: armed',
        '✓ battle-tested. ready to ship.',
    ];
    const [lines, setLines] = useState([]);
    const [currentMsg, setCurrentMsg] = useState(0);
    const [charIndex, setCharIndex] = useState(0);
    const feedRef = useRef(null);

    useEffect(() => {
        if (currentMsg >= messages.length) {
            const timeout = setTimeout(() => {
                setLines([]);
                setCurrentMsg(0);
                setCharIndex(0);
            }, 3000);
            return () => clearTimeout(timeout);
        }

        const msg = messages[currentMsg];
        if (charIndex < msg.length) {
            const timer = setTimeout(() => setCharIndex((c) => c + 1), 30);
            return () => clearTimeout(timer);
        } else {
            const timer = setTimeout(() => {
                setLines((prev) => [...prev, msg]);
                setCurrentMsg((c) => c + 1);
                setCharIndex(0);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [currentMsg, charIndex]);

    useEffect(() => {
        if (feedRef.current) {
            feedRef.current.scrollTop = feedRef.current.scrollHeight;
        }
    }, [lines, charIndex]);

    const currentText = currentMsg < messages.length ? messages[currentMsg].slice(0, charIndex) : '';

    return (
        <div className="card-container p-6 md:p-8 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-2">
                <div className="relative flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-signal pulse-dot" />
                    <span className="font-mono text-[10px] text-signal tracking-widest uppercase">Live Feed</span>
                </div>
            </div>
            <h3 className="font-heading font-bold text-lg md:text-xl tracking-brutal text-ink mb-1">
                Built to Ship
            </h3>
            <p className="font-heading text-sm text-ink/50 mb-6">
                Battle-Tested. Not Demo-Grade.
            </p>

            <div
                ref={feedRef}
                className="flex-1 bg-ink rounded-xl p-4 overflow-hidden font-mono text-xs leading-relaxed min-h-[160px]"
            >
                {lines.map((line, i) => (
                    <div key={i} className={line.startsWith('✓') ? 'text-green-400' : 'text-offwhite/60'}>
                        {line}
                    </div>
                ))}
                {currentMsg < messages.length && (
                    <div className={currentText.startsWith('✓') ? 'text-green-400' : 'text-offwhite/60'}>
                        {currentText}
                        <span className="cursor-blink text-signal">█</span>
                    </div>
                )}
            </div>
        </div>
    );
}

/* Card 3 — Cursor Protocol Scheduler */
function SchedulerCard() {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const [activeDay, setActiveDay] = useState(-1);
    const [cursorPos, setCursorPos] = useState({ x: -20, y: 50, visible: false });
    const [saved, setSaved] = useState(false);
    const [pressing, setPressing] = useState(-1);
    const sequenceRef = useRef(null);

    useEffect(() => {
        let step = 0;
        const targets = [2, 3, 4]; // T, W, T
        let cancelled = false;

        const runSequence = () => {
            if (cancelled) return;

            if (step === 0) {
                // cursor enters
                setCursorPos({ x: 10, y: 30, visible: true });
                setSaved(false);
                setActiveDay(-1);
                step++;
                sequenceRef.current = setTimeout(runSequence, 800);
            } else if (step <= targets.length) {
                const dayIdx = targets[step - 1];
                const xPos = 12 + dayIdx * 13;
                setCursorPos({ x: xPos, y: 50, visible: true });
                setTimeout(() => {
                    if (cancelled) return;
                    setPressing(dayIdx);
                    setTimeout(() => {
                        if (cancelled) return;
                        setPressing(-1);
                        setActiveDay(dayIdx);
                    }, 150);
                }, 400);
                step++;
                sequenceRef.current = setTimeout(runSequence, 1200);
            } else if (step === targets.length + 1) {
                // move to save button
                setCursorPos({ x: 70, y: 85, visible: true });
                setTimeout(() => {
                    if (cancelled) return;
                    setSaved(true);
                }, 500);
                step++;
                sequenceRef.current = setTimeout(runSequence, 2500);
            } else {
                // fade out and restart
                setCursorPos({ x: 70, y: 85, visible: false });
                step = 0;
                sequenceRef.current = setTimeout(runSequence, 1500);
            }
        };

        sequenceRef.current = setTimeout(runSequence, 1000);
        return () => {
            cancelled = true;
            clearTimeout(sequenceRef.current);
        };
    }, []);

    return (
        <div className="card-container p-6 md:p-8 flex flex-col h-full">
            <div className="flex items-center gap-2 mb-2">
                <GitBranch size={16} className="text-signal" />
                <span className="font-mono text-[10px] text-mid tracking-widest uppercase">Team</span>
            </div>
            <h3 className="font-heading font-bold text-lg md:text-xl tracking-brutal text-ink mb-1">
                Zero Drift
            </h3>
            <p className="font-heading text-sm text-ink/50 mb-6">
                Commit Config. Align the Team.
            </p>

            <div className="relative flex-1 bg-paper/50 rounded-xl p-4 min-h-[160px]">
                {/* Week grid */}
                <div className="grid grid-cols-7 gap-1 mb-3">
                    {days.map((d, i) => (
                        <div key={i} className="text-center font-mono text-[9px] text-ink/30 uppercase">
                            {d}
                        </div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1 mb-4">
                    {days.map((_, i) => (
                        <div
                            key={i}
                            className={`aspect-square rounded-lg border flex items-center justify-center text-[10px] font-mono transition-all duration-200 ${i === activeDay || (activeDay >= 2 && activeDay >= i && i >= 2 && i <= 4)
                                ? 'bg-signal border-signal text-offwhite'
                                : 'border-ink/10 text-ink/20'
                                } ${pressing === i ? 'scale-90' : ''}`}
                        >
                            {(i === activeDay || (activeDay >= 2 && activeDay >= i && i >= 2 && i <= 4)) && '●'}
                        </div>
                    ))}
                </div>

                {/* Save button */}
                <button
                    className={`w-full py-2 rounded-lg font-mono text-xs transition-all duration-300 ${saved
                        ? 'bg-signal text-offwhite'
                        : 'bg-ink/5 text-ink/40 border border-ink/10'
                        }`}
                >
                    {saved ? '✓ Synced' : 'Save Schedule'}
                </button>

                {/* Animated cursor */}
                <svg
                    className="absolute pointer-events-none transition-all duration-500 ease-out"
                    style={{
                        left: `${cursorPos.x}%`,
                        top: `${cursorPos.y}%`,
                        opacity: cursorPos.visible ? 1 : 0,
                        width: 16,
                        height: 20,
                    }}
                    viewBox="0 0 16 20"
                    fill="none"
                >
                    <path
                        d="M1 1L1 15L5 11L9 19L12 17.5L8 10L13 9L1 1Z"
                        fill="#111111"
                        stroke="#E8E4DD"
                        strokeWidth="1"
                    />
                </svg>
            </div>
        </div>
    );
}

function Features() {
    const sectionRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(
                '.feature-card',
                { y: 60, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.15,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: sectionRef.current,
                        start: 'top 75%',
                    },
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section id="features" ref={sectionRef} className="py-24 md:py-32 px-6 md:px-16 lg:px-24">
            <div className="max-w-6xl mx-auto">
                <div className="mb-12 md:mb-16">
                    <span className="font-mono text-[11px] text-signal tracking-widest uppercase">Capabilities</span>
                    <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-brutal text-ink mt-3">
                        Not features.<br />
                        <span className="font-drama italic text-signal">Instruments.</span>
                    </h2>
                </div>

                <div className="grid md:grid-cols-3 gap-4 md:gap-6">
                    <div className="feature-card"><ShufflerCard /></div>
                    <div className="feature-card"><TypewriterCard /></div>
                    <div className="feature-card"><SchedulerCard /></div>
                </div>
            </div>
        </section>
    );
}

/* ═══════════════════════════════════════════
   C2. PLUGINS — Mission Control
   ═══════════════════════════════════════════ */

const SCENARIOS = {
    fullstack: {
        title: 'Full-Stack Feature',
        command: '/implement "user profile with avatar upload"',
        steps: [
            {
                plugins: ['conductor'], lines: [
                    { text: '● conductor', color: 'text-signal' },
                    { text: '  loading product.md, tech-stack.md, workflow.md', color: 'text-offwhite/40' },
                    { text: '  ✓ project context loaded — React 19 + TanStack + Prisma', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['code-analysis'], lines: [
                    { text: '● code-analysis', color: 'text-signal' },
                    { text: '  semantic search: "user profile" across 847 files', color: 'text-offwhite/40' },
                    { text: '  ✓ 17 patterns found → 40% token reduction ($1.2k/mo saved)', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['frontend'], lines: [
                    { text: '● frontend → /implement phase:2', color: 'text-signal' },
                    { text: '  generating UserProfile.tsx + useProfile.ts + profileApi.ts', color: 'text-offwhite/40' },
                    { text: '  installing: @tanstack/react-query, react-dropzone', color: 'text-offwhite/40' },
                    { text: '  ✓ 3 files created — 247 lines', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['multimodel'], lines: [
                    { text: '● multimodel → /team review', color: 'text-signal' },
                    { text: '  grok-code-fast    ✓ approve', color: 'text-green-400' },
                    { text: '  gemini-3-pro      ✓ approve', color: 'text-green-400' },
                    { text: '  gpt-5-codex       ⚠ refactor L47: extract useAvatar hook', color: 'text-yellow-400' },
                    { text: '  consensus: 2/3 approve → applying fix at L47', color: 'text-offwhite/50' },
                ]
            },
            {
                plugins: ['frontend'], lines: [
                    { text: '● frontend → browser test (chromium headless)', color: 'text-signal' },
                    { text: '  ✓ layout pass  ✓ interactions pass  ✓ a11y pass', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['dev'], lines: [
                    { text: '● dev → generating tests + documentation', color: 'text-signal' },
                    { text: '  ✓ 12 tests passing  ✓ JSDoc complete', color: 'text-green-400' },
                    { text: '', color: '' },
                    { text: '━━━ DEPLOYED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', color: 'text-signal' },
                    { text: '  3 files · 247 lines · 12 tests · 4m 12s · 48k tokens', color: 'text-offwhite/30' },
                ]
            },
        ],
    },
    autopilot: {
        title: 'Autonomous Pipeline',
        command: '# zero human input — autopilot picks from Linear',
        steps: [
            {
                plugins: ['autopilot'], lines: [
                    { text: '● autopilot → scanning Linear backlog', color: 'text-signal' },
                    { text: '  picked: MAG-342 "Add password reset flow" [urgent]', color: 'text-offwhite/60' },
                    { text: '  tag: feature/auth → routing to frontend plugin', color: 'text-offwhite/40' },
                ]
            },
            {
                plugins: ['conductor', 'dev'], lines: [
                    { text: '● conductor → context loaded (product.md, tech-stack.md)', color: 'text-signal' },
                    { text: '● dev → stack detected: React + Bun + Prisma + Hono', color: 'text-signal' },
                    { text: '  ✓ skill loaded: auth-patterns, api-design', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['frontend', 'bun'], lines: [
                    { text: '● frontend → /implement-api "password reset"', color: 'text-signal' },
                    { text: '● bun → generating reset endpoint + email service', color: 'text-signal' },
                    { text: '  ✓ 8 files created — API + UI + tests', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['multimodel'], lines: [
                    { text: '● multimodel → 3-model consensus', color: 'text-signal' },
                    { text: '  confidence: 97/100 → auto-approve ✓', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['autopilot'], lines: [
                    { text: '● autopilot → PR opened, proof-of-work posted', color: 'text-signal' },
                    { text: '  ✓ MAG-342: In Review → Done', color: 'text-green-400' },
                    { text: '', color: '' },
                    { text: '━━━ AUTONOMOUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', color: 'text-signal' },
                    { text: '  0 human touches · 6m 34s · 62k tokens', color: 'text-offwhite/30' },
                ]
            },
        ],
    },
    content: {
        title: 'Content & Outreach',
        command: '/seo:start "AI code review tools 2025"',
        steps: [
            {
                plugins: ['seo'], lines: [
                    { text: '● seo → /research "AI code review tools"', color: 'text-signal' },
                    { text: '  12 keyword clusters · 8.4k searches/mo · KD: medium', color: 'text-offwhite/40' },
                    { text: '  ✓ content brief generated — 2,400 words target', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['seo'], lines: [
                    { text: '● seo → /optimize — writing article', color: 'text-signal' },
                    { text: '  E-E-A-T self-assessment: 87/100', color: 'text-offwhite/40' },
                    { text: '  ✓ "AI Code Review in 2025" — 2,380 words published', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['nanobanana'], lines: [
                    { text: '● nanobanana → generating hero images (Gemini 3 Pro)', color: 'text-signal' },
                    { text: '  style: brutalist-tech · 4 variants · 1024px', color: 'text-offwhite/40' },
                    { text: '  ✓ 4 images saved to /assets/blog/', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['video-editing'], lines: [
                    { text: '● video-editing → creating social clips', color: 'text-signal' },
                    { text: '  FFmpeg: article → 3 × 60s reels + captions (Whisper)', color: 'text-offwhite/40' },
                    { text: '  ✓ FCPXML timeline exported for Final Cut Pro', color: 'text-green-400' },
                ]
            },
            {
                plugins: ['instantly'], lines: [
                    { text: '● instantly → launching outreach', color: 'text-signal' },
                    { text: '  3-sequence campaign · 2,400 leads · A/B test active', color: 'text-offwhite/40' },
                    { text: '  ✓ campaign live — monitoring deliverability', color: 'text-green-400' },
                    { text: '', color: '' },
                    { text: '━━━ PIPELINE COMPLETE ━━━━━━━━━━━━━━━━━━━━━━━━', color: 'text-signal' },
                    { text: '  research → content → media → outreach · ~80% autonomous', color: 'text-offwhite/30' },
                ]
            },
        ],
    },
};

const ALL_PLUGINS = [
    { id: 'frontend', name: 'Frontend', sub: '11 agents · 13 skills' },
    { id: 'code-analysis', name: 'Code Analysis', sub: 'semantic search' },
    { id: 'bun', name: 'Bun Backend', sub: 'Hono + Prisma' },
    { id: 'dev', name: 'Dev', sub: '47 skills · universal' },
    { id: 'multimodel', name: 'Multimodel', sub: 'consensus engine' },
    { id: 'conductor', name: 'Conductor', sub: 'context mgmt' },
    { id: 'seo', name: 'SEO', sub: '80% autonomy' },
    { id: 'autopilot', name: 'Autopilot', sub: 'Linear → ship' },
    { id: 'video-editing', name: 'Video', sub: 'FFmpeg + FCP' },
    { id: 'nanobanana', name: 'Nanobanana', sub: 'Gemini images' },
    { id: 'instantly', name: 'Instantly', sub: 'email outreach' },
    { id: 'statusline', name: 'Statusline', sub: 'themed bar' },
];

function Plugins() {
    const sectionRef = useRef(null);
    const [activeScenario, setActiveScenario] = useState('fullstack');
    const [currentStep, setCurrentStep] = useState(0);
    const [visibleLines, setVisibleLines] = useState([]);
    const terminalRef = useRef(null);

    const scenario = SCENARIOS[activeScenario];

    // Reset when scenario changes
    useEffect(() => {
        setCurrentStep(0);
        setVisibleLines([]);
    }, [activeScenario]);

    // Auto-advance steps
    useEffect(() => {
        if (currentStep >= scenario.steps.length) {
            const timeout = setTimeout(() => {
                setCurrentStep(0);
                setVisibleLines([]);
            }, 4000);
            return () => clearTimeout(timeout);
        }

        const step = scenario.steps[currentStep];
        let lineIdx = 0;

        const addLine = () => {
            if (lineIdx < step.lines.length) {
                const line = step.lines[lineIdx];
                setVisibleLines((prev) => [...prev, line]);
                lineIdx++;
                return setTimeout(addLine, line.text === '' ? 100 : 120 + Math.random() * 80);
            } else {
                return setTimeout(() => {
                    setCurrentStep((s) => s + 1);
                }, 1200);
            }
        };

        const timer = addLine();
        return () => clearTimeout(timer);
    }, [currentStep, activeScenario]);

    // Auto-scroll terminal
    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [visibleLines]);

    // Which plugins are currently active
    const activePlugins = currentStep < scenario.steps.length
        ? scenario.steps[currentStep].plugins
        : [];

    // Which plugins have already been used
    const usedPlugins = scenario.steps
        .slice(0, currentStep)
        .flatMap((s) => s.plugins);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(
                '.mission-control',
                { y: 50, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 1,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: sectionRef.current,
                        start: 'top 65%',
                    },
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section id="plugins" ref={sectionRef} className="py-24 md:py-32 px-6 md:px-16 lg:px-24 bg-ink">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-6 md:mb-10">
                    <span className="font-mono text-[11px] text-signal tracking-widest uppercase">Plugin Ecosystem</span>
                    <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-brutal text-offwhite mt-3">
                        Plugins don't just run.<br />
                        They <span className="font-drama italic text-signal">orchestrate.</span>
                    </h2>
                    <p className="font-heading text-base text-offwhite/40 mt-3 max-w-2xl">
                        12 plugins. Not isolated tools — an interconnected system. One command triggers an entire pipeline. Watch it happen.
                    </p>
                </div>

                {/* Mission Control */}
                <div className="mission-control bg-[#0c0c0f] border border-offwhite/[0.06] rounded-[2rem] overflow-hidden shadow-2xl shadow-black/40">

                    {/* Top bar — scenario tabs */}
                    <div className="flex items-center justify-between border-b border-offwhite/[0.06] px-4 md:px-6">
                        <div className="flex">
                            {Object.entries(SCENARIOS).map(([key, s]) => (
                                <button
                                    key={key}
                                    onClick={() => setActiveScenario(key)}
                                    className={`px-4 md:px-5 py-3.5 font-mono text-[11px] tracking-wider transition-all duration-300 border-b-2 ${activeScenario === key
                                            ? 'text-signal border-signal'
                                            : 'text-offwhite/25 border-transparent hover:text-offwhite/50'
                                        }`}
                                >
                                    {s.title}
                                </button>
                            ))}
                        </div>
                        <div className="hidden md:flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-400/60 pulse-dot" />
                            <span className="font-mono text-[9px] text-offwhite/20 tracking-wider">LIVE DEMO</span>
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row">
                        {/* Sidebar — plugin map */}
                        <div className="hidden md:block w-56 border-r border-offwhite/[0.06] py-4 px-3 flex-shrink-0">
                            <div className="font-mono text-[9px] text-offwhite/15 tracking-widest uppercase px-2 mb-3">
                                Plugins
                            </div>
                            {ALL_PLUGINS.map((p) => {
                                const isActive = activePlugins.includes(p.id);
                                const isUsed = usedPlugins.includes(p.id);
                                return (
                                    <div
                                        key={p.id}
                                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all duration-500 mb-0.5 ${isActive ? 'bg-signal/10' : ''
                                            }`}
                                    >
                                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all duration-500 ${isActive ? 'bg-signal shadow-[0_0_8px_rgba(230,59,46,0.6)]' : isUsed ? 'bg-green-400/50' : 'bg-offwhite/10'
                                            }`} />
                                        <div className="min-w-0">
                                            <div className={`font-mono text-[10px] leading-tight transition-colors duration-500 ${isActive ? 'text-signal' : isUsed ? 'text-offwhite/50' : 'text-offwhite/20'
                                                }`}>
                                                {p.name}
                                            </div>
                                            <div className={`font-mono text-[8px] leading-tight transition-colors duration-500 ${isActive ? 'text-signal/40' : 'text-offwhite/10'
                                                }`}>
                                                {p.sub}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Main terminal area */}
                        <div className="flex-1 flex flex-col min-h-[420px] md:min-h-[480px]">
                            {/* Command bar */}
                            <div className="border-b border-offwhite/[0.04] px-5 py-3 flex items-center gap-2">
                                <span className="text-signal font-mono text-xs">$</span>
                                <span className="font-mono text-xs text-offwhite/50">{scenario.command}</span>
                                {currentStep === 0 && visibleLines.length === 0 && (
                                    <span className="cursor-blink text-signal text-xs">█</span>
                                )}
                            </div>

                            {/* Terminal output */}
                            <div
                                ref={terminalRef}
                                className="flex-1 px-5 py-4 overflow-y-auto font-mono text-[11px] md:text-xs leading-relaxed space-y-0.5"
                                style={{ maxHeight: '420px' }}
                            >
                                {visibleLines.map((line, i) => (
                                    <div
                                        key={i}
                                        className={`${line.color} transition-opacity duration-300`}
                                        style={{ opacity: 1 }}
                                    >
                                        {line.text || '\u00A0'}
                                    </div>
                                ))}
                                {currentStep < scenario.steps.length && (
                                    <div className="text-signal">
                                        <span className="cursor-blink">█</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Bottom bar — stats */}
                    <div className="border-t border-offwhite/[0.06] px-4 md:px-6 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-4 md:gap-6">
                            {[
                                { val: '12', label: 'plugins' },
                                { val: '100+', label: 'agents' },
                                { val: '200+', label: 'skills' },
                            ].map((s) => (
                                <div key={s.label} className="flex items-center gap-1.5">
                                    <span className="font-heading font-bold text-sm text-offwhite/60">{s.val}</span>
                                    <span className="font-mono text-[9px] text-offwhite/15 tracking-wider uppercase">{s.label}</span>
                                </div>
                            ))}
                        </div>
                        <div className="font-mono text-[10px] text-offwhite/20">
                            <span className="text-signal">$</span> /plugin marketplace add MadAppGang/magus
                        </div>
                    </div>
                </div>

                {/* Below: install + one-liner */}
                <div className="mt-10 text-center">
                    <p className="font-heading text-sm text-offwhite/30 mb-4">
                        Install the ecosystem. Commit config. Your whole team auto-syncs.
                    </p>
                    <div className="inline-flex items-center gap-3 bg-offwhite/[0.04] border border-offwhite/[0.08] rounded-full px-5 py-2.5">
                        <Terminal size={14} className="text-signal" />
                        <code className="font-mono text-xs text-offwhite/50">
                            /plugin marketplace add MadAppGang/magus
                        </code>
                    </div>
                </div>
            </div>
        </section>
    );
}


/* Animated pipeline node */
function PipelineNode({ label, plugin, active, done, delay = 0 }) {
    return (
        <div
            className={`relative flex flex-col items-center transition-all duration-700`}
            style={{ transitionDelay: `${delay}ms` }}
        >
            <div
                className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center border transition-all duration-500 ${done
                    ? 'bg-green-400/20 border-green-400/40 text-green-400'
                    : active
                        ? 'bg-signal/20 border-signal text-signal scale-110 shadow-lg shadow-signal/20'
                        : 'bg-offwhite/5 border-offwhite/10 text-offwhite/20'
                    }`}
            >
                {done ? '✓' : active ? '◉' : '○'}
            </div>
            <span
                className={`mt-2 font-mono text-[9px] tracking-wider uppercase text-center leading-tight ${done ? 'text-green-400/70' : active ? 'text-signal' : 'text-offwhite/20'
                    }`}
            >
                {plugin}
            </span>
            <span
                className={`font-heading text-[10px] mt-0.5 text-center ${done ? 'text-offwhite/50' : active ? 'text-offwhite/70' : 'text-offwhite/15'
                    }`}
            >
                {label}
            </span>
        </div>
    );
}

/* Connector arrow between nodes */
function PipelineArrow({ active, done }) {
    return (
        <div className="flex items-center mx-1 md:mx-2 mt-[-20px]">
            <div
                className={`h-[2px] w-6 md:w-10 transition-all duration-500 ${done ? 'bg-green-400/40' : active ? 'bg-signal/60' : 'bg-offwhite/10'
                    }`}
            />
            <div
                className={`w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] transition-all duration-500 ${done ? 'border-l-green-400/40' : active ? 'border-l-signal/60' : 'border-l-offwhite/10'
                    }`}
            />
        </div>
    );
}

/* Scenario 1: Full-Stack Feature Pipeline */
function FullStackScenario() {
    const [step, setStep] = useState(0);
    const totalSteps = 6;

    useEffect(() => {
        const interval = setInterval(() => {
            setStep((s) => (s + 1) % (totalSteps + 2));
        }, 2200);
        return () => clearInterval(interval);
    }, []);

    const nodes = [
        { plugin: 'Conductor', label: 'Load context' },
        { plugin: 'Code Analysis', label: 'Scan codebase' },
        { plugin: 'Frontend', label: '/implement' },
        { plugin: 'Multimodel', label: '3-model review' },
        { plugin: 'Frontend', label: 'Browser test' },
        { plugin: 'Dev', label: 'Ship & doc' },
    ];

    return (
        <div className="bg-offwhite/[0.03] border border-offwhite/10 rounded-[2rem] p-6 md:p-8">
            <div className="flex items-center gap-2 mb-1">
                <Code2 size={14} className="text-signal" />
                <span className="font-mono text-[10px] text-signal tracking-widest uppercase">Scenario</span>
            </div>
            <h3 className="font-heading font-bold text-lg md:text-xl text-offwhite tracking-tight mb-1">
                Full-Stack Feature
            </h3>
            <p className="font-heading text-xs text-offwhite/35 mb-6 max-w-md">
                "Build a user profile page with avatar upload and bio editing."<br />
                <span className="text-offwhite/50">6 plugins chain. One command triggers the entire pipeline.</span>
            </p>

            {/* Animated pipeline */}
            <div className="flex items-start justify-between overflow-x-auto pb-4 scrollbar-hide">
                {nodes.map((node, i) => (
                    <div key={i} className="flex items-start">
                        <PipelineNode
                            label={node.label}
                            plugin={node.plugin}
                            active={step === i}
                            done={step > i}
                            delay={i * 50}
                        />
                        {i < nodes.length - 1 && (
                            <PipelineArrow active={step === i + 1} done={step > i} />
                        )}
                    </div>
                ))}
            </div>

            {/* Live terminal output */}
            <div className="bg-ink rounded-xl p-4 mt-4 font-mono text-[10px] leading-relaxed min-h-[80px]">
                {step === 0 && <div className="text-offwhite/40">$ /implement "user profile page"<span className="cursor-blink text-signal ml-1">█</span></div>}
                {step === 1 && (
                    <>
                        <div className="text-offwhite/30">conductor → loading product.md, tech-stack.md</div>
                        <div className="text-green-400">✓ project context loaded</div>
                    </>
                )}
                {step === 2 && (
                    <>
                        <div className="text-offwhite/30">code-analysis → semantic search: "user profile"</div>
                        <div className="text-green-400">✓ 17 related patterns found, 40% token reduction</div>
                    </>
                )}
                {step === 3 && (
                    <>
                        <div className="text-offwhite/30">frontend → Phase 2: implementing UserProfile.tsx</div>
                        <div className="text-signal">◉ generating component + hooks + API layer...</div>
                    </>
                )}
                {step === 4 && (
                    <>
                        <div className="text-offwhite/30">multimodel → grok: ✓ approve | gemini: ✓ approve | gpt-5: ⚠ refactor L47</div>
                        <div className="text-yellow-400">→ applying consensus fix at line 47</div>
                    </>
                )}
                {step === 5 && (
                    <>
                        <div className="text-offwhite/30">frontend → browser test: chromium headless</div>
                        <div className="text-green-400">✓ layout pass | ✓ interactions pass | ✓ a11y pass</div>
                    </>
                )}
                {step >= 6 && (
                    <>
                        <div className="text-green-400">✓ UserProfile shipped — 3 files, 247 lines, 12 tests</div>
                        <div className="text-offwhite/20">elapsed: 4m 12s | tokens: 48k (−40% via semantic search)</div>
                    </>
                )}
            </div>
        </div>
    );
}

/* Scenario 2: Autonomous Task Pipeline */
function AutopilotScenario() {
    const [step, setStep] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setStep((s) => (s + 1) % 7);
        }, 2400);
        return () => clearInterval(interval);
    }, []);

    const nodes = [
        { plugin: 'Autopilot', label: 'Pick Linear task' },
        { plugin: 'Conductor', label: 'Build context' },
        { plugin: 'Dev', label: 'Detect stack' },
        { plugin: 'Frontend', label: 'Execute' },
        { plugin: 'Multimodel', label: 'Validate' },
    ];

    return (
        <div className="bg-offwhite/[0.03] border border-offwhite/10 rounded-[2rem] p-6 md:p-8">
            <div className="flex items-center gap-2 mb-1">
                <Bot size={14} className="text-signal" />
                <span className="font-mono text-[10px] text-signal tracking-widest uppercase">Scenario</span>
            </div>
            <h3 className="font-heading font-bold text-lg md:text-xl text-offwhite tracking-tight mb-1">
                Autonomous Pipeline
            </h3>
            <p className="font-heading text-xs text-offwhite/35 mb-6 max-w-md">
                Zero human input. Autopilot picks tasks from Linear, routes to the right plugins, executes, validates with 3 models, and posts proof-of-work.
            </p>

            <div className="flex items-start justify-between overflow-x-auto pb-4 scrollbar-hide">
                {nodes.map((node, i) => (
                    <div key={i} className="flex items-start">
                        <PipelineNode
                            label={node.label}
                            plugin={node.plugin}
                            active={step === i}
                            done={step > i}
                        />
                        {i < nodes.length - 1 && (
                            <PipelineArrow active={step === i + 1} done={step > i} />
                        )}
                    </div>
                ))}
            </div>

            <div className="bg-ink rounded-xl p-4 mt-4 font-mono text-[10px] leading-relaxed min-h-[60px]">
                {step === 0 && <div className="text-offwhite/40">autopilot → scanning Linear backlog...<span className="cursor-blink text-signal ml-1">█</span></div>}
                {step === 1 && <div className="text-signal">◉ picked: MAG-342 "Add password reset flow" [priority: urgent]</div>}
                {step === 2 && <div className="text-offwhite/40">conductor → context loaded | dev → stack: React + Bun + Prisma</div>}
                {step === 3 && <div className="text-signal">◉ frontend → /implement-api "password reset"</div>}
                {step === 4 && <div className="text-green-400">✓ 3-model consensus: merge | confidence: 97/100</div>}
                {step >= 5 && (
                    <>
                        <div className="text-green-400">✓ PR opened → proof-of-work posted to Linear</div>
                        <div className="text-offwhite/20">MAG-342: In Review → Done (autonomous, 0 human touches)</div>
                    </>
                )}
            </div>
        </div>
    );
}

/* Scenario 3: Content & Media Pipeline */
function ContentScenario() {
    const [step, setStep] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setStep((s) => (s + 1) % 7);
        }, 2000);
        return () => clearInterval(interval);
    }, []);

    const nodes = [
        { plugin: 'SEO', label: 'Keyword research' },
        { plugin: 'SEO', label: 'Write content' },
        { plugin: 'Nanobanana', label: 'Generate images' },
        { plugin: 'Video Editing', label: 'Create video' },
        { plugin: 'Instantly', label: 'Email campaign' },
    ];

    return (
        <div className="bg-offwhite/[0.03] border border-offwhite/10 rounded-[2rem] p-6 md:p-8">
            <div className="flex items-center gap-2 mb-1">
                <BarChart3 size={14} className="text-signal" />
                <span className="font-mono text-[10px] text-signal tracking-widest uppercase">Scenario</span>
            </div>
            <h3 className="font-heading font-bold text-lg md:text-xl text-offwhite tracking-tight mb-1">
                Content & Outreach
            </h3>
            <p className="font-heading text-xs text-offwhite/35 mb-6 max-w-md">
                From keyword research to published content to email outreach — five plugins handle the entire content pipeline with ~80% autonomy.
            </p>

            <div className="flex items-start justify-between overflow-x-auto pb-4 scrollbar-hide">
                {nodes.map((node, i) => (
                    <div key={i} className="flex items-start">
                        <PipelineNode
                            label={node.label}
                            plugin={node.plugin}
                            active={step === i}
                            done={step > i}
                        />
                        {i < nodes.length - 1 && (
                            <PipelineArrow active={step === i + 1} done={step > i} />
                        )}
                    </div>
                ))}
            </div>

            <div className="bg-ink rounded-xl p-4 mt-4 font-mono text-[10px] leading-relaxed min-h-[60px]">
                {step === 0 && <div className="text-offwhite/40">seo → /research "AI code review tools"<span className="cursor-blink text-signal ml-1">█</span></div>}
                {step === 1 && <div className="text-green-400">✓ 12 keyword clusters found | volume: 8.4k/mo</div>}
                {step === 2 && <div className="text-signal">◉ seo → writing article: "AI Code Review in 2025"</div>}
                {step === 3 && <div className="text-signal">◉ nanobanana → generating 4 hero images (Gemini 3 Pro)</div>}
                {step === 4 && <div className="text-offwhite/40">video-editing → FFmpeg: creating social clips from article</div>}
                {step >= 5 && (
                    <>
                        <div className="text-green-400">✓ instantly → 3-sequence campaign launched to 2.4k leads</div>
                        <div className="text-offwhite/20">pipeline complete: research → content → media → outreach</div>
                    </>
                )}
            </div>
        </div>
    );
}

/* Plugin relationship map */
function PluginRelationshipMap() {
    const relationships = [
        { from: 'Autopilot', to: 'Dev', type: 'delegates' },
        { from: 'Autopilot', to: 'Conductor', type: 'context' },
        { from: 'Dev', to: 'Multimodel', type: 'reviews' },
        { from: 'Dev', to: 'Frontend', type: 'routes' },
        { from: 'Dev', to: 'Bun', type: 'routes' },
        { from: 'Frontend', to: 'Code Analysis', type: 'enriches' },
        { from: 'Multimodel', to: 'Claudish', type: 'proxies' },
        { from: 'SEO', to: 'Nanobanana', type: 'images' },
    ];

    return (
        <div className="bg-offwhite/[0.03] border border-offwhite/10 rounded-[2rem] p-6 md:p-8">
            <div className="flex items-center gap-2 mb-1">
                <Workflow size={14} className="text-signal" />
                <span className="font-mono text-[10px] text-signal tracking-widest uppercase">Architecture</span>
            </div>
            <h3 className="font-heading font-bold text-lg md:text-xl text-offwhite tracking-tight mb-4">
                Plugin Dependencies
            </h3>

            <div className="space-y-2">
                {relationships.map((r, i) => (
                    <div
                        key={i}
                        className="flex items-center gap-2 font-mono text-[11px] py-1.5 px-3 rounded-lg bg-offwhite/[0.02] border border-offwhite/5"
                    >
                        <span className="text-offwhite/60 font-semibold min-w-[90px]">{r.from}</span>
                        <span className="text-offwhite/15">→</span>
                        <span className="text-signal text-[9px] tracking-wider uppercase min-w-[60px]">{r.type}</span>
                        <span className="text-offwhite/15">→</span>
                        <span className="text-offwhite/40">{r.to}</span>
                    </div>
                ))}
            </div>

            {/* Compact plugin count */}
            <div className="mt-6 pt-4 border-t border-offwhite/5 grid grid-cols-3 gap-3">
                {[
                    { count: '12', label: 'Plugins' },
                    { count: '100+', label: 'Agents' },
                    { count: '200+', label: 'Skills' },
                ].map((s) => (
                    <div key={s.label} className="text-center">
                        <div className="font-heading font-bold text-lg text-offwhite">{s.count}</div>
                        <div className="font-mono text-[9px] text-offwhite/20 tracking-widest uppercase">{s.label}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function Plugins() {
    const sectionRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(
                '.scenario-card',
                { y: 50, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.15,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: sectionRef.current,
                        start: 'top 65%',
                    },
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    const allPlugins = [
        { name: 'Frontend', ver: '3.15', icon: Code2 },
        { name: 'Code Analysis', ver: '3.2', icon: Search },
        { name: 'Bun', ver: '1.6', icon: Server },
        { name: 'Dev', ver: '1.32', icon: Layers },
        { name: 'Multimodel', ver: '2.4', icon: Bot },
        { name: 'Conductor', ver: '2.1', icon: Workflow },
        { name: 'SEO', ver: '1.6', icon: BarChart3 },
        { name: 'Autopilot', ver: '0.2', icon: Settings },
        { name: 'Video', ver: '1.1', icon: Video },
        { name: 'Nanobanana', ver: '2.3', icon: Image },
        { name: 'Instantly', ver: '1.0', icon: Mail },
        { name: 'Statusline', ver: '1.4', icon: Palette },
    ];

    return (
        <section id="plugins" ref={sectionRef} className="py-24 md:py-32 px-6 md:px-16 lg:px-24 bg-ink">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="mb-6 md:mb-10">
                    <span className="font-mono text-[11px] text-signal tracking-widest uppercase">Plugin Ecosystem</span>
                    <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-brutal text-offwhite mt-3">
                        Plugins don't just run.<br />
                        They <span className="font-drama italic text-signal">orchestrate.</span>
                    </h2>
                    <p className="font-heading text-base md:text-lg text-offwhite/40 mt-3 max-w-2xl">
                        12 plugins. Not isolated tools — an interconnected system where each plugin delegates, enriches, and validates through others. One command triggers an entire pipeline.
                    </p>
                </div>

                {/* Install command */}
                <div className="bg-offwhite/5 border border-offwhite/10 rounded-2xl p-4 md:p-5 mb-10 md:mb-14 max-w-xl">
                    <div className="font-mono text-[10px] text-offwhite/30 mb-2">INSTALL THE ECOSYSTEM</div>
                    <div className="font-mono text-xs text-offwhite/70">
                        <span className="text-signal">$</span> /plugin marketplace add MadAppGang/magus
                    </div>
                    <div className="font-mono text-xs text-offwhite/40 mt-1">
                        <span className="text-offwhite/20">→</span> Enable per-project in <span className="text-offwhite/60">.claude/settings.json</span> — commit, and your team auto-syncs.
                    </div>
                </div>

                {/* Scenarios grid */}
                <div className="grid lg:grid-cols-2 gap-4 md:gap-6 mb-6">
                    <div className="scenario-card lg:col-span-2">
                        <FullStackScenario />
                    </div>
                    <div className="scenario-card">
                        <AutopilotScenario />
                    </div>
                    <div className="scenario-card">
                        <ContentScenario />
                    </div>
                    <div className="scenario-card lg:col-span-2">
                        <PluginRelationshipMap />
                    </div>
                </div>

                {/* Compact plugin bar */}
                <div className="mt-10 pt-8 border-t border-offwhite/5">
                    <div className="font-mono text-[10px] text-offwhite/20 tracking-widest uppercase mb-4">All 12 Plugins</div>
                    <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2">
                        {allPlugins.map((p) => {
                            const Icon = p.icon;
                            return (
                                <div
                                    key={p.name}
                                    className="group flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl bg-offwhite/[0.02] hover:bg-offwhite/[0.06] border border-transparent hover:border-offwhite/10 transition-all duration-300 cursor-default"
                                >
                                    <Icon size={16} className="text-offwhite/30 group-hover:text-signal transition-colors" />
                                    <span className="font-mono text-[8px] text-offwhite/25 group-hover:text-offwhite/50 text-center leading-tight transition-colors">
                                        {p.name}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
}

/* ═══════════════════════════════════════════
   D. PHILOSOPHY — "The Manifesto"
   ═══════════════════════════════════════════ */
function Philosophy() {
    const sectionRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            // Word-by-word reveal for manifesto text
            const words = sectionRef.current.querySelectorAll('.word');
            gsap.fromTo(
                words,
                { opacity: 0.1, y: 8 },
                {
                    opacity: 1,
                    y: 0,
                    duration: 0.4,
                    stagger: 0.04,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: sectionRef.current,
                        start: 'top 60%',
                        end: 'bottom 40%',
                        scrub: 0.5,
                    },
                }
            );

            // Parallax texture
            gsap.to('.philosophy-texture', {
                yPercent: -20,
                ease: 'none',
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top bottom',
                    end: 'bottom top',
                    scrub: true,
                },
            });
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    const splitWords = (text, className = '') =>
        text.split(' ').map((w, i) => (
            <span key={i} className={`word inline-block mr-[0.3em] ${className}`}>
                {w}
            </span>
        ));

    return (
        <section ref={sectionRef} className="relative py-32 md:py-48 px-6 md:px-16 lg:px-24 bg-ink overflow-hidden">
            {/* Parallax texture */}
            <div
                className="philosophy-texture absolute inset-0 opacity-[0.06] bg-cover bg-center"
                style={{
                    backgroundImage: `url('https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=1920&q=60')`,
                    transform: 'scale(1.3)',
                }}
            />

            <div className="relative z-10 max-w-5xl mx-auto">
                <div className="mb-12">
                    <p className="font-heading text-lg md:text-2xl text-offwhite/40 leading-relaxed">
                        {splitWords('Most developer tools focus on: demos, prototypes, and toy projects that never see production.')}
                    </p>
                </div>

                <div>
                    <p className="font-heading font-bold text-2xl md:text-5xl lg:text-6xl text-offwhite leading-tight tracking-brutal">
                        {splitWords('We focus on:')}
                        <br />
                        <span className="font-drama italic">
                            {splitWords('production-grade', 'text-signal')}
                        </span>
                        <br />
                        {splitWords('orchestration at')}
                        <span className="font-drama italic">
                            {splitWords(' scale.', 'text-signal')}
                        </span>
                    </p>
                </div>
            </div>
        </section>
    );
}

/* ═══════════════════════════════════════════
   E. PROTOCOL — "Sticky Stacking Archive"
   ═══════════════════════════════════════════ */

function RotatingMotif() {
    const canvasRef = useRef(null);

    useEffect(() => {
        let raf;
        let angle = 0;
        const draw = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width = canvas.offsetWidth * 2;
            const h = canvas.height = canvas.offsetHeight * 2;
            ctx.scale(2, 2);
            const cw = w / 4;
            const ch = h / 4;
            ctx.clearRect(0, 0, w, h);

            for (let i = 0; i < 6; i++) {
                ctx.save();
                ctx.translate(cw, ch);
                ctx.rotate((angle + i * 12) * (Math.PI / 180));
                const size = 30 + i * 15;
                ctx.strokeStyle = i % 2 === 0 ? '#E63B2E' : '#E8E4DD';
                ctx.lineWidth = 1;
                ctx.strokeRect(-size / 2, -size / 2, size, size);
                ctx.restore();
            }

            angle += 0.3;
            raf = requestAnimationFrame(draw);
        };
        draw();
        return () => cancelAnimationFrame(raf);
    }, []);

    return <canvas ref={canvasRef} className="w-full h-full" />;
}

function ScannerMotif() {
    const canvasRef = useRef(null);

    useEffect(() => {
        let raf;
        let lineY = 0;
        const draw = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width = canvas.offsetWidth * 2;
            const h = canvas.height = canvas.offsetHeight * 2;
            ctx.scale(2, 2);
            const cw = w / 4;
            const ch = h / 4;
            ctx.clearRect(0, 0, w, h);

            // Dot grid
            const spacing = 20;
            for (let x = spacing; x < cw; x += spacing) {
                for (let y = spacing; y < ch; y += spacing) {
                    const dist = Math.abs(y - lineY);
                    const brightness = dist < 30 ? 1 : 0.15;
                    ctx.fillStyle = dist < 30 ? '#E63B2E' : '#E8E4DD';
                    ctx.globalAlpha = brightness;
                    ctx.beginPath();
                    ctx.arc(x, y, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;

            // Scan line
            ctx.strokeStyle = '#E63B2E';
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(0, lineY);
            ctx.lineTo(cw, lineY);
            ctx.stroke();
            ctx.globalAlpha = 1;

            lineY += 0.5;
            if (lineY > ch) lineY = 0;
            raf = requestAnimationFrame(draw);
        };
        draw();
        return () => cancelAnimationFrame(raf);
    }, []);

    return <canvas ref={canvasRef} className="w-full h-full" />;
}

function WaveformMotif() {
    const svgRef = useRef(null);

    useEffect(() => {
        let raf;
        let offset = 0;
        const animate = () => {
            if (svgRef.current) {
                const path = svgRef.current.querySelector('path');
                if (path) {
                    path.setAttribute('stroke-dashoffset', offset);
                    offset -= 2;
                }
            }
            raf = requestAnimationFrame(animate);
        };
        animate();
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <svg ref={svgRef} viewBox="0 0 400 100" className="w-full h-full" preserveAspectRatio="none">
            <path
                d="M0,50 Q25,20 50,50 Q75,80 100,50 Q125,20 150,50 Q175,80 200,50 Q225,20 250,50 Q275,80 300,50 Q325,20 350,50 Q375,80 400,50"
                fill="none"
                stroke="#E63B2E"
                strokeWidth="2"
                strokeDasharray="8 4"
                strokeDashoffset="0"
                opacity="0.7"
            />
            <path
                d="M0,50 Q25,35 50,50 Q75,65 100,50 Q125,35 150,50 Q175,65 200,50 Q225,35 250,50 Q275,65 300,50 Q325,35 350,50 Q375,65 400,50"
                fill="none"
                stroke="#E8E4DD"
                strokeWidth="1"
                strokeDasharray="4 6"
                strokeDashoffset="0"
                opacity="0.3"
            />
        </svg>
    );
}

function Protocol() {
    const sectionRef = useRef(null);
    const cardsRef = useRef([]);

    const steps = [
        {
            num: '01',
            title: 'Configure',
            desc: 'Define your agent fleet in a single config file. Roles, tools, constraints — all version-controlled.',
            Motif: RotatingMotif,
        },
        {
            num: '02',
            title: 'Execute',
            desc: 'Launch 50 agents with one command. Watch them decompose, parallelize, and converge in real time.',
            Motif: ScannerMotif,
        },
        {
            num: '03',
            title: 'Converge',
            desc: "Every agent's output merges into one coherent result. Deterministic. Reproducible. Production-ready.",
            Motif: WaveformMotif,
        },
    ];

    useEffect(() => {
        const ctx = gsap.context(() => {
            cardsRef.current.forEach((card, i) => {
                if (i < steps.length - 1) {
                    ScrollTrigger.create({
                        trigger: card,
                        start: 'top 10%',
                        end: 'bottom 10%',
                        pin: true,
                        pinSpacing: true,
                        onUpdate: (self) => {
                            const progress = self.progress;
                            gsap.to(card, {
                                scale: 1 - progress * 0.08,
                                filter: `blur(${progress * 15}px)`,
                                opacity: 1 - progress * 0.4,
                                duration: 0.1,
                            });
                        },
                    });
                }
            });
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section id="protocol" ref={sectionRef} className="py-24 md:py-32">
            <div className="px-6 md:px-16 lg:px-24 mb-12 md:mb-16 max-w-6xl mx-auto">
                <span className="font-mono text-[11px] text-signal tracking-widest uppercase">Protocol</span>
                <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-brutal text-ink mt-3">
                    Three steps.<br />
                    <span className="font-drama italic text-signal">No complexity.</span>
                </h2>
            </div>

            {steps.map((step, i) => (
                <div
                    key={step.num}
                    ref={(el) => (cardsRef.current[i] = el)}
                    className="px-6 md:px-16 lg:px-24 mb-8"
                >
                    <div className="max-w-6xl mx-auto bg-offwhite border border-paper rounded-[2.5rem] overflow-hidden shadow-sm">
                        <div className="grid md:grid-cols-2 min-h-[70vh]">
                            <div className="flex flex-col justify-center p-8 md:p-16">
                                <span className="font-mono text-xs text-signal tracking-widest mb-4">
                                    {step.num}
                                </span>
                                <h3 className="font-heading font-bold text-4xl md:text-6xl tracking-brutal text-ink mb-4">
                                    {step.title}
                                </h3>
                                <p className="font-heading text-base md:text-lg text-ink/50 max-w-md leading-relaxed">
                                    {step.desc}
                                </p>
                            </div>
                            <div className="relative bg-ink/[0.03] flex items-center justify-center p-8 min-h-[300px]">
                                <div className="w-full h-64 md:h-80">
                                    <step.Motif />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </section>
    );
}

/* ═══════════════════════════════════════════
   F. PRICING
   ═══════════════════════════════════════════ */
function Pricing() {
    const sectionRef = useRef(null);

    const tiers = [
        {
            name: 'Solo',
            price: 'Free',
            desc: 'For individual developers exploring agent-driven workflows.',
            features: ['Up to 5 agents', 'Local execution', 'Community support', 'Basic config templates'],
            cta: 'Download Free',
            featured: false,
        },
        {
            name: 'Team',
            price: '$49',
            period: '/seat/mo',
            desc: 'For teams shipping production code with coordinated agent fleets.',
            features: ['Up to 50 agents', 'Shared config repos', 'Priority support', 'Advanced orchestration', 'Team analytics'],
            cta: 'Start Trial',
            featured: true,
        },
        {
            name: 'Enterprise',
            price: 'Custom',
            desc: 'For organizations requiring dedicated infrastructure and compliance.',
            features: ['Unlimited agents', 'SSO & RBAC', 'SLA guarantee', 'Dedicated instance', 'Custom integrations'],
            cta: 'Contact Sales',
            featured: false,
        },
    ];

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(
                '.pricing-card',
                { y: 60, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    stagger: 0.15,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: sectionRef.current,
                        start: 'top 70%',
                    },
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section id="pricing" ref={sectionRef} className="py-24 md:py-32 px-6 md:px-16 lg:px-24">
            <div className="max-w-6xl mx-auto">
                <div className="mb-12 md:mb-16 text-center">
                    <span className="font-mono text-[11px] text-signal tracking-widest uppercase">Pricing</span>
                    <h2 className="font-heading font-bold text-3xl md:text-5xl tracking-brutal text-ink mt-3">
                        Pick your <span className="font-drama italic text-signal">firepower.</span>
                    </h2>
                </div>

                <div className="grid md:grid-cols-3 gap-4 md:gap-6">
                    {tiers.map((tier) => (
                        <div
                            key={tier.name}
                            className={`pricing-card rounded-[2rem] p-8 flex flex-col ${tier.featured
                                ? 'bg-ink text-offwhite ring-2 ring-signal shadow-xl scale-[1.02]'
                                : 'bg-offwhite border border-paper text-ink'
                                }`}
                        >
                            <span className={`font-mono text-[10px] tracking-widest uppercase ${tier.featured ? 'text-signal' : 'text-mid'}`}>
                                {tier.name}
                            </span>
                            <div className="mt-3 mb-2 flex items-baseline gap-1">
                                <span className="font-heading font-bold text-4xl tracking-brutal">
                                    {tier.price}
                                </span>
                                {tier.period && (
                                    <span className={`font-mono text-xs ${tier.featured ? 'text-offwhite/40' : 'text-ink/40'}`}>
                                        {tier.period}
                                    </span>
                                )}
                            </div>
                            <p className={`font-heading text-sm mb-6 ${tier.featured ? 'text-offwhite/50' : 'text-ink/50'}`}>
                                {tier.desc}
                            </p>

                            <ul className="space-y-3 mb-8 flex-1">
                                {tier.features.map((f) => (
                                    <li key={f} className={`flex items-center gap-2 font-mono text-xs ${tier.featured ? 'text-offwhite/70' : 'text-ink/60'}`}>
                                        <span className="text-signal">▸</span>
                                        {f}
                                    </li>
                                ))}
                            </ul>

                            <button
                                className={`btn-magnetic w-full py-3 rounded-xl font-heading font-semibold text-sm tracking-tight ${tier.featured
                                    ? 'bg-signal text-offwhite'
                                    : 'bg-ink text-offwhite'
                                    }`}
                            >
                                <span className={`btn-bg ${tier.featured ? 'bg-offwhite/20' : 'bg-signal'}`}></span>
                                <span>{tier.cta}</span>
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

/* ═══════════════════════════════════════════
   DOWNLOAD CTA
   ═══════════════════════════════════════════ */
function DownloadCTA() {
    const sectionRef = useRef(null);
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText('curl -fsSL https://mad.codes/install | sh');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, []);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.fromTo(
                '.download-content',
                { y: 40, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 0.8,
                    ease: 'power3.out',
                    scrollTrigger: {
                        trigger: sectionRef.current,
                        start: 'top 70%',
                    },
                }
            );
        }, sectionRef);
        return () => ctx.revert();
    }, []);

    return (
        <section id="download" ref={sectionRef} className="py-24 md:py-32 px-6 md:px-16 lg:px-24">
            <div className="download-content max-w-3xl mx-auto text-center">
                <span className="font-mono text-[11px] text-signal tracking-widest uppercase">Get Started</span>
                <h2 className="font-heading font-bold text-4xl md:text-6xl lg:text-7xl tracking-brutal text-ink mt-4 mb-6">
                    Stop demoing.<br />
                    <span className="font-drama italic text-signal">Start shipping.</span>
                </h2>
                <p className="font-heading text-base md:text-lg text-ink/50 mb-10 max-w-lg mx-auto">
                    One command. Your fleet of AI agents deploys, coordinates, and delivers production-grade code.
                </p>

                {/* Install command */}
                <div
                    onClick={handleCopy}
                    className="cursor-pointer inline-flex items-center gap-3 bg-ink rounded-2xl px-6 py-4 mb-8 group transition-all hover:shadow-lg"
                >
                    <Terminal size={16} className="text-signal" />
                    <code className="font-mono text-sm text-offwhite/80">
                        curl -fsSL https://mad.codes/install | sh
                    </code>
                    <span className="font-mono text-xs text-signal group-hover:text-offwhite transition-colors">
                        {copied ? '✓ copied' : 'copy'}
                    </span>
                </div>

                <div className="flex flex-wrap justify-center gap-3">
                    <a
                        href="#"
                        className="btn-magnetic inline-flex items-center gap-2 bg-signal text-offwhite px-8 py-4 rounded-full font-heading font-semibold text-base tracking-tight"
                    >
                        <span className="btn-bg bg-ink"></span>
                        <Download size={18} />
                        <span>Download MAD Code</span>
                    </a>
                    <a
                        href="#"
                        className="btn-magnetic inline-flex items-center gap-2 bg-transparent border-2 border-ink text-ink px-8 py-4 rounded-full font-heading font-medium text-base tracking-tight"
                    >
                        <span className="btn-bg bg-ink/5"></span>
                        <span>View on GitHub</span>
                        <ExternalLink size={14} />
                    </a>
                </div>
            </div>
        </section>
    );
}

/* ═══════════════════════════════════════════
   G. FOOTER
   ═══════════════════════════════════════════ */
function Footer() {
    return (
        <footer className="bg-ink rounded-t-[3rem] md:rounded-t-[4rem] pt-16 md:pt-20 pb-8 px-6 md:px-16 lg:px-24 mt-8">
            <div className="max-w-6xl mx-auto">
                <div className="grid md:grid-cols-4 gap-10 md:gap-8 mb-16">
                    {/* Brand */}
                    <div className="md:col-span-1">
                        <h3 className="font-heading font-bold text-xl text-offwhite tracking-brutal mb-2">
                            MAD <span className="text-signal">Code</span>
                        </h3>
                        <p className="font-heading text-sm text-offwhite/40 leading-relaxed">
                            Production-grade AI agent orchestration. Built by engineers, for engineers.
                        </p>
                    </div>

                    {/* Links */}
                    <div>
                        <h4 className="font-mono text-[10px] text-signal tracking-widest uppercase mb-4">Product</h4>
                        <ul className="space-y-2">
                            {['Features', 'Protocol', 'Pricing', 'Changelog'].map((l) => (
                                <li key={l}>
                                    <a href="#" className="font-heading text-sm text-offwhite/40 hover:text-offwhite lift-hover inline-block transition-colors">
                                        {l}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h4 className="font-mono text-[10px] text-signal tracking-widest uppercase mb-4">Resources</h4>
                        <ul className="space-y-2">
                            {['Documentation', 'API Reference', 'Examples', 'Blog'].map((l) => (
                                <li key={l}>
                                    <a href="#" className="font-heading text-sm text-offwhite/40 hover:text-offwhite lift-hover inline-block transition-colors">
                                        {l}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h4 className="font-mono text-[10px] text-signal tracking-widest uppercase mb-4">Company</h4>
                        <ul className="space-y-2">
                            {['About', 'Careers', 'Contact', 'Legal'].map((l) => (
                                <li key={l}>
                                    <a href="#" className="font-heading text-sm text-offwhite/40 hover:text-offwhite lift-hover inline-block transition-colors">
                                        {l}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Bottom bar */}
                <div className="border-t border-offwhite/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-400 pulse-dot" />
                        <span className="font-mono text-[11px] text-offwhite/30 tracking-wider">
                            System Operational
                        </span>
                    </div>
                    <p className="font-mono text-[11px] text-offwhite/20">
                        © 2025 MAD Code. All rights reserved.
                    </p>
                </div>
            </div>
        </footer>
    );
}

/* ═══════════════════════════════════════════
   APP
   ═══════════════════════════════════════════ */
export default function App() {
    return (
        <div className="relative">
            <Navbar />
            <Hero />
            <Features />
            <Plugins />
            <Philosophy />
            <Protocol />
            <Pricing />
            <DownloadCTA />
            <Footer />
        </div>
    );
}
