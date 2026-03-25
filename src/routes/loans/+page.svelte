<script>
	import loanData from '$lib/data/loanProducts.json';
	import { banks } from '$lib/data/bankEligibilityData.js';
	import { fade } from 'svelte/transition';

	let activeProduct = 0;
	let activeTab = 'details';
	let selectedCibilRange = '750-779';
	let selectedLoanType = 'Home Loan';
	let bankSearch = '';

	const cibilRanges = ['650-699', '700-729', '730-749', '750-779', '780-799', '800+', 'No CIBIL or -1'];

	const loanTypes = [
		{ key: 'HL/Construction/Plot+Construction/Plot', label: 'Home Loan / Plot' },
		{ key: 'Top up', label: 'Top Up' },
		{ key: 'LAP', label: 'Loan Against Property' },
		{ key: 'Personal Loan', label: 'Personal Loan' },
		{ key: 'Business Loan', label: 'Business Loan' },
		{ key: 'Professional Loan', label: 'Professional Loan' }
	];

	const loanIcons = {
		'Business Loan': '💼',
		'Loan Against Property (LAP)': '🏢',
		'Plot Loan': '🌍'
	};

	function getRoiKey(loanType, cibilRange) {
		const prefix = loanType === 'Top up' ? 'Top up  ROI' : loanType === 'LAP' ? 'LAP  ROI' : loanType === 'Professional Loan' ? 'Professional Loan  ROI' : `(${loanType}) ROI`;
		return `${prefix} as per CIBIL / ${cibilRange}`;
	}

	function getBankRoi(bank, loanTypeKey, cibilRange) {
		// Try different key patterns
		const patterns = [
			`(${loanTypeKey}) ROI as per CIBIL / ${cibilRange}`,
			`${loanTypeKey}  ROI as per CIBIL / ${cibilRange}`,
			`${loanTypeKey} ROI as per CIBIL / ${cibilRange}`
		];

		for (const pattern of patterns) {
			if (bank[pattern] !== undefined && bank[pattern] !== null) {
				return bank[pattern];
			}
		}
		return null;
	}

	function getLoanEligibility(bank, loanType) {
		const eligibilityKeys = {
			'Home Loan / Plot': ['Home Loan-Direct Sale', 'Plot Loan-Direct Sale from Builder'],
			'Top Up': ['Top up'],
			'Loan Against Property': ['LAP-Against Residential Property'],
			'Personal Loan': ['Personal Loan'],
			'Business Loan': ['Business Loan'],
			'Professional Loan': ['Professional Loan']
		};

		const keys = eligibilityKeys[loanType] || [];
		return keys.some(k => bank[k] === 'Yes');
	}

	$: filteredBanks = banks.filter(bank => {
		const matchesSearch = !bankSearch || bank.BankName.toLowerCase().includes(bankSearch.toLowerCase());
		const selectedType = loanTypes.find(t => t.label === selectedLoanType);
		const roi = selectedType ? getBankRoi(bank, selectedType.key, selectedCibilRange) : null;
		return matchesSearch && roi !== null;
	}).sort((a, b) => {
		const selectedType = loanTypes.find(t => t.label === selectedLoanType);
		if (!selectedType) return 0;
		const roiA = getBankRoi(a, selectedType.key, selectedCibilRange) || 999;
		const roiB = getBankRoi(b, selectedType.key, selectedCibilRange) || 999;
		return roiA - roiB;
	});

	$: currentProduct = loanData.products[activeProduct];
</script>

<svelte:head>
	<title>Loan Products — RERA Toolkit</title>
</svelte:head>

<div class="space-y-16 pb-20">
	<!-- Header -->
	<section class="text-center space-y-4">
		<h1 class="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
			Loan <span class="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">Products</span>
		</h1>
		<p class="mx-auto max-w-2xl text-lg text-slate-500">
			Compare loan products, check eligibility, and find the best interest rates from {banks.length}+ partner banks.
		</p>
	</section>

	<!-- Product Selector Tabs -->
	<section class="space-y-8">
		<div class="flex flex-wrap justify-center gap-3">
			{#each loanData.products as product, i}
				<button
					on:click={() => { activeProduct = i; activeTab = 'details'; }}
					class="flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all {activeProduct === i ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-200 hover:text-indigo-600'}"
				>
					<span class="text-lg">{loanIcons[product.name] || '💰'}</span>
					{product.name}
				</button>
			{/each}
		</div>

		<!-- Product Content -->
		{#key activeProduct}
			<div class="rounded-3xl border border-slate-200 bg-white shadow-sm" in:fade={{ duration: 200 }}>
				<!-- Product Header -->
				<div class="border-b border-slate-100 p-6 sm:p-8">
					<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 class="text-2xl font-bold text-slate-900">{currentProduct.name}</h2>
							<p class="mt-1 text-slate-500">{currentProduct.shortDescription}</p>
						</div>
						{#if currentProduct.applicationUrl}
							<a
								href={currentProduct.applicationUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-indigo-500 hover:scale-105"
							>
								Apply Now
								<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
								</svg>
							</a>
						{/if}
					</div>

					<!-- Inner tabs -->
					<div class="mt-6 flex gap-1 rounded-xl bg-slate-100 p-1">
						<button
							on:click={() => activeTab = 'details'}
							class="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all {activeTab === 'details' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
						>
							Details
						</button>
						<button
							on:click={() => activeTab = 'faq'}
							class="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all {activeTab === 'faq' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
						>
							FAQ ({currentProduct.faq.length})
						</button>
					</div>
				</div>

				<!-- Details Tab -->
				{#if activeTab === 'details'}
					<div class="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3 sm:p-8">
						{#each currentProduct.options as option}
							<div class="rounded-2xl border border-slate-100 bg-slate-50/50 p-5 transition-colors hover:border-indigo-100 hover:bg-indigo-50/30">
								<div class="flex items-center gap-2">
									<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
										{#if option.title === 'Eligibility'}
											<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
										{:else if option.title === 'Interest Rates'}
											<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
										{:else if option.title === 'Loan Amount'}
											<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
										{:else if option.title === 'Tenure'}
											<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
										{:else}
											<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
										{/if}
									</div>
									<h3 class="font-bold text-slate-900">{option.title}</h3>
								</div>
								<p class="mt-3 text-sm leading-relaxed text-slate-600">{option.description}</p>
							</div>
						{/each}
					</div>
				{/if}

				<!-- FAQ Tab -->
				{#if activeTab === 'faq'}
					<div class="divide-y divide-slate-100 p-6 sm:p-8">
						{#each currentProduct.faq as faq, i}
							<details class="group py-4 first:pt-0 last:pb-0">
								<summary class="flex cursor-pointer items-center justify-between text-sm font-semibold text-slate-900 transition-colors hover:text-indigo-600 [&::-webkit-details-marker]:hidden">
									{faq.question}
									<svg class="h-5 w-5 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
									</svg>
								</summary>
								<p class="mt-3 text-sm leading-relaxed text-slate-600">{faq.answer}</p>
							</details>
						{/each}
					</div>
				{/if}
			</div>
		{/key}
	</section>

	<!-- Bank ROI Comparison Tool -->
	<section id="banks" class="space-y-8 scroll-mt-24">
		<div class="text-center">
			<h2 class="text-3xl font-bold tracking-tight text-slate-900">Bank Interest Rate Comparison</h2>
			<p class="mt-2 text-slate-500">Compare rates across {banks.length} banks based on your CIBIL score and loan type.</p>
		</div>

		<!-- Filters -->
		<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
			<div class="grid gap-4 sm:grid-cols-3">
				<div>
					<label for="loan-type" class="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Loan Type</label>
					<select
						id="loan-type"
						bind:value={selectedLoanType}
						class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
					>
						{#each loanTypes as type}
							<option value={type.label}>{type.label}</option>
						{/each}
					</select>
				</div>

				<div>
					<label for="cibil-range" class="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">CIBIL Score Range</label>
					<select
						id="cibil-range"
						bind:value={selectedCibilRange}
						class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
					>
						{#each cibilRanges as range}
							<option value={range}>{range}</option>
						{/each}
					</select>
				</div>

				<div>
					<label for="bank-search" class="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Search Bank</label>
					<input
						id="bank-search"
						type="text"
						bind:value={bankSearch}
						placeholder="Type bank name..."
						class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm placeholder-slate-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
					/>
				</div>
			</div>
		</div>

		<!-- Bank Cards -->
		{#if filteredBanks.length === 0}
			<div class="rounded-2xl border border-slate-200 bg-white py-16 text-center">
				<svg class="mx-auto h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
				<p class="mt-4 text-sm text-slate-500">No banks found for this combination.</p>
			</div>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each filteredBanks as bank, i (bank.BankName)}
					<div
						class="rounded-2xl border border-slate-200 bg-white p-5 transition-all hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-500/5 {i === 0 ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}"
						in:fade={{ duration: 150, delay: Math.min(i * 30, 300) }}
					>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-600">
									{bank.BankName.slice(0, 2).toUpperCase()}
								</div>
								<div>
									<h3 class="text-sm font-bold text-slate-900">{bank.BankName}</h3>
									<span class="text-[10px] font-medium uppercase tracking-wider text-slate-400">{bank.Classification}</span>
								</div>
							</div>
							{#if i === 0}
								<span class="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700">Best Rate</span>
							{/if}
						</div>

						<div class="mt-4 rounded-xl bg-slate-50 p-4">
							<div class="text-center">
								<div class="text-3xl font-extrabold text-slate-900">
									{(() => {
										const type = loanTypes.find(t => t.label === selectedLoanType);
										const roi = type ? getBankRoi(bank, type.key, selectedCibilRange) : null;
										return roi !== null ? `${roi}%` : 'N/A';
									})()}
								</div>
								<div class="mt-1 text-xs text-slate-500">per annum</div>
							</div>
						</div>

						<!-- Eligible products indicators -->
						<div class="mt-4 flex flex-wrap gap-1.5">
							{#if bank['Home Loan-Direct Sale'] === 'Yes'}
								<span class="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Home Loan</span>
							{/if}
							{#if bank['Personal Loan'] === 'Yes'}
								<span class="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Personal</span>
							{/if}
							{#if bank['Business Loan'] === 'Yes'}
								<span class="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Business</span>
							{/if}
							{#if bank['LAP-Against Residential Property'] === 'Yes'}
								<span class="rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700">LAP</span>
							{/if}
							{#if bank['Top up'] === 'Yes'}
								<span class="rounded-md bg-pink-50 px-2 py-0.5 text-[10px] font-medium text-pink-700">Top Up</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<p class="text-center text-xs text-slate-400">
				Showing {filteredBanks.length} banks for {selectedLoanType} with CIBIL {selectedCibilRange}. Sorted by interest rate (lowest first).
			</p>
		{/if}
	</section>

	<!-- General FAQ -->
	<section id="faq" class="space-y-8 scroll-mt-24">
		<div class="text-center">
			<h2 class="text-3xl font-bold tracking-tight text-slate-900">General FAQs</h2>
			<p class="mt-2 text-slate-500">Common questions about our loan services.</p>
		</div>

		<div class="mx-auto max-w-3xl divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
			{#each loanData.generalFaq as faq}
				<details class="group">
					<summary class="flex cursor-pointer items-center justify-between px-6 py-5 text-sm font-semibold text-slate-900 transition-colors hover:text-indigo-600 [&::-webkit-details-marker]:hidden">
						{faq.question}
						<svg class="h-5 w-5 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</summary>
					<div class="px-6 pb-5 text-sm leading-relaxed text-slate-600">
						{faq.answer}
					</div>
				</details>
			{/each}
		</div>
	</section>
</div>
