<script>
	import '../app.css';
	import { page } from '$app/stores';
	import EnhancedAssistant from '$lib/components/EnhancedAssistant.svelte';
	import { assistantConfig } from '$lib/config/assistant';

	const currentYear = new Date().getFullYear();
	let mobileMenuOpen = false;
	let statesOpen = false;
	let toolsOpen = false;
	let mobileStatesOpen = false;
	let mobileToolsOpen = false;

	const stateLinks = [
		{ state: 'UP', agents: '/up-rera-agent', promoters: '/up-rera-promoters' },
		{ state: 'Delhi', agents: '/delhi-rera-agent', promoters: '/delhi-rera-promoters' },
		{ state: 'MP', agents: '/mp-rera-agent', promoters: '/mp-rera-promoters' },
		{ state: 'Punjab', agents: '/punjab-rera-agent', promoters: '/punjab-rera-promoters' },
		{ state: 'Maharashtra', agents: '/maharashtra-rera-agent', promoters: '/maharashtra-rera-promoters' },
		{ state: 'Rajasthan', agents: '/rajasthan-rera-agent', promoters: null },
		{ state: 'Telangana', agents: '/telangana-rera-agent', promoters: '/telangana-rera-projects', agentsLabel: 'Agents', promotersLabel: 'Projects' }
	];

	const primaryLinks = [
		{ href: '/', label: 'Home', description: 'Overview' },
		{ href: '/browse', label: 'Browse', description: 'Explore records' }
	];

	const toolLinks = [
		{ href: '/loans', label: 'Loans', description: 'Financing options' },
		{ href: '/zoneGenerator', label: 'Zone Generator', description: 'Area planning tool' },
		{ href: '/demo', label: 'Demo', description: 'Assistant showcase' },
		{ href: '/admin', label: 'Admin', description: 'Manage data' }
	];

	function isActive(href) {
		return $page.url.pathname === href;
	}

	function isStateActive() {
		return stateLinks.some(
			(s) => isActive(s.agents) || (s.promoters && isActive(s.promoters))
		);
	}

	function isToolActive() {
		return toolLinks.some((link) => isActive(link.href));
	}
</script>

<div class="min-h-screen flex flex-col bg-slate-50 text-slate-900">
	<header class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl shadow-sm shadow-slate-200/60">
		<div class="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3">

			<!-- Logo -->
			<a href="/" class="flex shrink-0 items-center gap-3 font-semibold tracking-tight">
				<span class="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-sky-600 text-sm font-bold text-white shadow-lg shadow-indigo-500/30 ring-1 ring-indigo-400/30">
					R
				</span>
				<span class="flex flex-col leading-none">
					<span class="text-base font-bold text-slate-900">RERA <span class="text-indigo-600">Toolkit</span></span>
					<span class="mt-1 text-[11px] font-medium tracking-[0.22em] text-slate-400 uppercase">Property Intelligence</span>
				</span>
			</a>

			<!-- Desktop nav -->
			<nav class="hidden items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/80 p-1.5 text-sm font-medium text-slate-600 shadow-sm shadow-slate-200/60 xl:flex">
				{#each primaryLinks as link}
					<a
						href={link.href}
						class="group flex items-center gap-2 rounded-xl px-3.5 py-2.5 transition-all {isActive(link.href) ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/10' : 'hover:bg-slate-100 hover:text-slate-900'}"
					>
						<span class="h-1.5 w-1.5 rounded-full transition-colors {isActive(link.href) ? 'bg-emerald-300' : 'bg-slate-300 group-hover:bg-indigo-500'}"></span>
						<span>{link.label}</span>
					</a>
				{/each}

				<!-- States dropdown -->
				<div
					class="relative"
					role="presentation"
					on:mouseenter={() => {
						statesOpen = true;
						toolsOpen = false;
					}}
					on:mouseleave={() => statesOpen = false}
				>
					<button
						class="flex items-center gap-2 rounded-xl px-3.5 py-2.5 transition-all {isStateActive() ? 'bg-indigo-50 text-indigo-700 shadow-sm shadow-indigo-100' : 'hover:bg-slate-100 hover:text-slate-900'}"
						on:click={() => statesOpen = !statesOpen}
					>
						<svg class="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
						<div class="text-left leading-tight">
							<div>States</div>
							<div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Agent directories</div>
						</div>
						<svg class="h-3.5 w-3.5 opacity-50 transition-transform {statesOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
						</svg>
					</button>

					{#if statesOpen}
						<div
							class="absolute left-0 top-full mt-2 w-[21rem] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-200/80"
							role="presentation"
							on:mouseenter={() => statesOpen = true}
						>
							<div class="mb-2 flex items-center justify-between px-2 pt-1">
								<div>
									<div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">State Directories</div>
									<div class="mt-1 text-xs text-slate-500">Jump into verified state-level RERA records.</div>
								</div>
								<span class="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-indigo-600">7 States</span>
							</div>
							{#each stateLinks as s}
								<div class="rounded-xl px-2 py-2 transition-colors hover:bg-slate-50">
									<div class="mb-1.5 flex items-center justify-between">
										<div class="text-xs font-bold text-slate-700">{s.state}</div>
										<div class="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Records</div>
									</div>
									<div class="flex gap-2">
										<a
											href={s.agents}
											on:click={() => statesOpen = false}
											class="flex-1 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors {isActive(s.agents) ? 'border-indigo-200 bg-indigo-100 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-indigo-100 hover:bg-indigo-50 hover:text-indigo-600'}"
										>{s.agentsLabel || 'Agents'}</a>
										{#if s.promoters}
											<a
												href={s.promoters}
												on:click={() => statesOpen = false}
												class="flex-1 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors {isActive(s.promoters) ? 'border-indigo-200 bg-indigo-100 text-indigo-700' : 'border-slate-200 text-slate-500 hover:border-indigo-100 hover:bg-indigo-50 hover:text-indigo-600'}"
											>Promoters</a>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Tools dropdown -->
				<div
					class="relative"
					role="presentation"
					on:mouseenter={() => {
						toolsOpen = true;
						statesOpen = false;
					}}
					on:mouseleave={() => toolsOpen = false}
				>
					<button
						class="flex items-center gap-2 rounded-xl px-3.5 py-2.5 transition-all {isToolActive() ? 'bg-indigo-50 text-indigo-700 shadow-sm shadow-indigo-100' : 'hover:bg-slate-100 hover:text-slate-900'}"
						on:click={() => toolsOpen = !toolsOpen}
					>
						<svg class="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M7 12h10M10 17h4" />
						</svg>
						<div class="text-left leading-tight">
							<div>Tools</div>
							<div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Workflows</div>
						</div>
						<svg class="h-3.5 w-3.5 opacity-50 transition-transform {toolsOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
						</svg>
					</button>

					{#if toolsOpen}
						<div class="absolute left-1/2 top-full mt-2 w-[22rem] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-200/80">
							<div class="mb-2 px-2 pt-1">
								<div class="text-[10px] font-bold uppercase tracking-widest text-slate-400">Toolkit Access</div>
								<div class="mt-1 text-xs text-slate-500">Core actions and internal utilities in one place.</div>
							</div>
							<div class="grid gap-2">
								{#each toolLinks as link}
									<a
										href={link.href}
										on:click={() => toolsOpen = false}
										class="flex items-center justify-between rounded-xl border px-3 py-3 transition-all {isActive(link.href) ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'}"
									>
										<div>
											<div class="text-sm font-semibold">{link.label}</div>
											<div class="text-xs text-slate-400">{link.description}</div>
										</div>
										<span class="text-sm">&rarr;</span>
									</a>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</nav>

			<div class="flex items-center gap-2">
				<a
					href="/demo"
					class="hidden items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition-all hover:-translate-y-0.5 hover:bg-slate-800 sm:flex"
				>
					<svg class="h-3.5 w-3.5 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
					</svg>
					Launch Demo
				</a>

				<!-- Mobile hamburger -->
				<button
					class="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 xl:hidden"
					on:click={() => {
						mobileMenuOpen = !mobileMenuOpen;
						if (!mobileMenuOpen) {
							mobileStatesOpen = false;
							mobileToolsOpen = false;
						}
					}}
					aria-label="Toggle navigation menu"
					aria-expanded={mobileMenuOpen}
				>
					{#if mobileMenuOpen}
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					{:else}
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
						</svg>
					{/if}
				</button>
			</div>
		</div>

		<!-- Mobile menu -->
		{#if mobileMenuOpen}
			<nav class="border-t border-slate-100 bg-white/95 px-4 pb-5 pt-4 backdrop-blur-xl xl:hidden">
				<div class="mb-4 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 p-4 text-white shadow-lg shadow-slate-200/80">
					<div class="text-xs font-bold uppercase tracking-[0.22em] text-indigo-200">Navigation</div>
					<div class="mt-2 text-lg font-bold">Find RERA records, tools, and guided workflows faster.</div>
				</div>

				<div class="flex flex-col gap-1">
					{#each primaryLinks as link}
						<a
							href={link.href}
							on:click={() => mobileMenuOpen = false}
							class="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-semibold transition-colors {isActive(link.href) ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}"
						>
							<div>
								<div>{link.label}</div>
								<div class="text-xs {isActive(link.href) ? 'text-slate-300' : 'text-slate-400'}">{link.description}</div>
							</div>
							<span class="text-sm">&rarr;</span>
						</a>
					{/each}

					<!-- States accordion -->
					<button
						class="flex w-full items-center justify-between rounded-xl px-3 py-3 text-sm font-semibold transition-colors {isStateActive() ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}"
						on:click={() => mobileStatesOpen = !mobileStatesOpen}
					>
						<span class="flex items-center gap-2">
							<svg class="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
							</svg>
							State Directories
						</span>
						<svg class="h-4 w-4 text-slate-400 transition-transform {mobileStatesOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
						</svg>
					</button>

					{#if mobileStatesOpen}
						<div class="mb-1 ml-3 mt-0.5 rounded-2xl border border-slate-100 bg-slate-50 p-2.5">
							{#each stateLinks as s}
								<div class="py-1.5">
									<div class="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{s.state}</div>
									<div class="flex gap-2 px-1">
										<a
											href={s.agents}
											on:click={() => { mobileMenuOpen = false; mobileStatesOpen = false; }}
											class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors {isActive(s.agents) ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-white hover:text-slate-900'}"
										>Agents</a>
										{#if s.promoters}
											<a
												href={s.promoters}
												on:click={() => { mobileMenuOpen = false; mobileStatesOpen = false; }}
												class="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors {isActive(s.promoters) ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-white hover:text-slate-900'}"
											>Promoters</a>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<button
						class="flex w-full items-center justify-between rounded-xl px-3 py-3 text-sm font-semibold transition-colors {isToolActive() ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'}"
						on:click={() => mobileToolsOpen = !mobileToolsOpen}
					>
						<span class="flex items-center gap-2">
							<svg class="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M7 12h10M10 17h4" />
							</svg>
							Tools
						</span>
						<svg class="h-4 w-4 text-slate-400 transition-transform {mobileToolsOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
						</svg>
					</button>

					{#if mobileToolsOpen}
						<div class="mb-1 ml-3 mt-0.5 rounded-2xl border border-slate-100 bg-slate-50 p-2.5">
							{#each toolLinks as link}
								<a
									href={link.href}
									on:click={() => {
										mobileMenuOpen = false;
										mobileToolsOpen = false;
									}}
									class="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-semibold transition-colors {isActive(link.href) ? 'bg-indigo-100 text-indigo-700' : 'text-slate-700 hover:bg-white'}"
								>
									<div>
										<div>{link.label}</div>
										<div class="text-xs {isActive(link.href) ? 'text-indigo-500' : 'text-slate-400'}">{link.description}</div>
									</div>
									<span class="text-sm">&rarr;</span>
								</a>
							{/each}
						</div>
					{/if}

					<a
						href="/demo"
						on:click={() => mobileMenuOpen = false}
						class="mt-2 flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
					>
						<svg class="h-4 w-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
						</svg>
						Launch Demo
					</a>
				</div>
			</nav>
		{/if}
	</header>

	<main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
		<slot />
	</main>

	<footer class="border-t border-slate-200 bg-white">
		<div class="mx-auto w-full max-w-6xl px-4 py-10">
			<div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
				<!-- Brand -->
				<div class="space-y-3">
					<div class="flex items-center gap-2">
						<span class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">R</span>
						<span class="font-semibold">RERA Toolkit</span>
					</div>
					<p class="text-sm text-slate-500 leading-relaxed">
						Comprehensive platform for verifying RERA registered agents and exploring loan products across India.
					</p>
				</div>

				<!-- RERA Directories -->
				<div>
					<h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">State Directories</h4>
					<ul class="mt-3 space-y-2">
						<li><a href="/up-rera-agent" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">UP Agents</a></li>
						<li><a href="/up-rera-promoters" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">UP Promoters & Projects</a></li>
						<li><a href="/delhi-rera-agent" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Delhi Agents</a></li>
						<li><a href="/delhi-rera-promoters" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Delhi Promoters & Projects</a></li>
						<li><a href="/mp-rera-agent" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">MP Agents</a></li>
						<li><a href="/mp-rera-promoters" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">MP Promoters & Projects</a></li>
						<li><a href="/punjab-rera-agent" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Punjab Agents</a></li>
						<li><a href="/punjab-rera-promoters" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Punjab Promoters & Projects</a></li>
						<li><a href="/maharashtra-rera-agent" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Maharashtra Agents</a></li>
						<li><a href="/maharashtra-rera-promoters" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Maharashtra Promoters & Projects</a></li>
						<li><a href="/rajasthan-rera-agent" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Rajasthan</a></li>
							<li><a href="/telangana-rera-projects" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Telangana Projects</a></li>
					</ul>
				</div>

				<!-- Loan Products -->
				<div>
					<h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">Loan Products</h4>
					<ul class="mt-3 space-y-2">
						<li><a href="/loans" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Business Loan</a></li>
						<li><a href="/loans" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Loan Against Property</a></li>
						<li><a href="/loans" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Plot Loan</a></li>
						<li><a href="/loans" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Bank Eligibility</a></li>
					</ul>
				</div>

				<!-- Resources -->
				<div>
					<h4 class="text-xs font-bold uppercase tracking-wider text-slate-400">Resources</h4>
					<ul class="mt-3 space-y-2">
						<li><a href="/demo" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Virtual Assistant</a></li>
						<li><a href="/loans#faq" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">FAQs</a></li>
					</ul>
				</div>
			</div>

			<div class="mt-8 border-t border-slate-100 pt-6 text-center text-xs text-slate-400">
				<span>&copy; {currentYear} RERA Toolkit. All rights reserved.</span>
			</div>
		</div>
	</footer>

	<EnhancedAssistant
		botName={assistantConfig.name}
		useApi={assistantConfig.useApi}
		suggestions={assistantConfig.features?.suggestions ? assistantConfig.suggestions : []}
	/>
</div>
