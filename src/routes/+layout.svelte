<script>
	import '../app.css';
	import EnhancedAssistant from '$lib/components/EnhancedAssistant.svelte';
	import { assistantConfig } from '$lib/config/assistant';

	const currentYear = new Date().getFullYear();
	let mobileMenuOpen = false;

	const navLinks = [
		{ href: '/up-rera-agent', label: 'UP Agents' },
		{ href: '/up-rera-promoters', label: 'UP Promoters' },
		{ href: '/delhi-rera-agent', label: 'Delhi Agents' },
		{ href: '/delhi-rera-promoters', label: 'Delhi Promoters' },
		{ href: '/mp-rera-agent', label: 'MP Agents' },
		{ href: '/mp-rera-promoters', label: 'MP Promoters' },
		{ href: '/punjab-rera-agent', label: 'Punjab Agents' },
		{ href: '/punjab-rera-promoters', label: 'Punjab Promoters' },
		{ href: '/rajasthan-rera-agent', label: 'Rajasthan' },
		{ href: '/loans', label: 'Loans' },
		{ href: '/browse', label: 'Browse' },
		{ href: '/admin', label: 'Admin' },
		{ href: '/dashboard', label: 'UP Dashboard' }
	];
</script>

<div class="min-h-screen flex flex-col bg-slate-50 text-slate-900">
	<header class="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-lg">
		<div class="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
			<a href="/" class="flex items-center gap-2.5 font-semibold tracking-tight">
				<span
					class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white shadow-sm shadow-indigo-500/20"
				>
					R
				</span>
				<span class="text-lg">RERA Toolkit</span>
			</a>

			<!-- Desktop nav -->
			<nav class="hidden items-center gap-1 text-sm font-medium text-slate-600 md:flex">
				{#each navLinks as link}
					<a class="rounded-lg px-3 py-2 transition-colors hover:bg-slate-100 hover:text-slate-900" href={link.href}>{link.label}</a>
				{/each}
			</nav>

			<div class="flex items-center gap-2">
				<a
					class="hidden rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-800 sm:block"
					href="/demo"
				>
					Demo
				</a>

				<!-- Mobile hamburger -->
				<button
					class="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 md:hidden"
					on:click={() => mobileMenuOpen = !mobileMenuOpen}
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
			<nav class="border-t border-slate-100 bg-white px-4 pb-4 pt-2 md:hidden">
				<div class="flex flex-col gap-1">
					{#each navLinks as link}
						<a
							class="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
							href={link.href}
							on:click={() => mobileMenuOpen = false}
						>
							{link.label}
						</a>
					{/each}
					<a
						class="mt-2 rounded-lg bg-slate-900 px-3 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-slate-800"
						href="/demo"
						on:click={() => mobileMenuOpen = false}
					>
						Demo
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
						<li><a href="/rajasthan-rera-agent" class="text-sm text-slate-600 hover:text-indigo-600 transition-colors">Rajasthan</a></li>
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
