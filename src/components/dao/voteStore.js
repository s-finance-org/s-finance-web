import Vue from 'vue'
import Web3 from 'web3'

import { contract } from '../../contract'
import poolAbis from '../../allabis'

import * as allabis from './allabis'

let ALL_POOLS = Object.values(poolAbis).map(pool => pool.swap_address.toLowerCase())
//Rinkeby test pool
ALL_POOLS.push('0x47A63DDe77f6b1B0c529f39bF8C9D194D76E76c4')


import * as radspec from 'radspec'

const radspecFormat = {
	userHelpers: {
		address: () => async (address, prefix) => {
			if(!prefix) prefix = ''
			return {
				type: 'string',
				value: '<br> ' + prefix + ' ' + shortenAddress(address),
			}
		},
		param: () => async (param, name) => {
			if(!name) name = ''
			return {
				type: 'string',
				value: '<br> ' + name + ':' + param,
			}
		},
	}
}

import gql from 'graphql-tag'
import { GraphQLWrapper } from '@aragon/connect-thegraph'

import { connect, describeScript } from '@aragon/connect'
import { Voting } from '@aragon/connect-thegraph-voting'

import { groupBy, setTimeoutPromise } from '../../utils/helpers'

import BN from 'bignumber.js'

export const VOTING_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/pengiundev/aragon-curvevoting-rinkeby' 

export const OWNERSHIP_VOTE_TIME = 3600
export const PARAMETER_VOTE_TIME = 3600
export const OWNERSHIP_APP_ADDRESS = '0x96B58C29c74fce0aBFE7c0C62225095f47A91A6D'
export const PARAMETER_APP_ADDRESS = '0x3ef19f1EA214DF368Eb8a612dd1Aca45caC3c756'
export const OWNERSHIP_AGENT = '0x9D82050e8ce9541968b01B0F67CF6aa76c34892B'
export const PARAMETER_AGENT = '0x6fF8BA3250d0167Af033Ddc215F89177f09aDF1B'
export const MIN_BALANCE = 2500 * 10 ** 18
export const MIN_TIME = 15

const CALLSCRIPT_ID = '0x00000001'

export let state = Vue.observable({
	initialized: false,
	org: null,
	apps: [],
	ownershipVotingApp: null,
	parameterVotingApp: null,
	votingApps: [],
	votes: [],
	votingEscrow: null,
	lastCreated: null,

	transactionIntent: null,

	showModal: false,
	showRootModal: false,

	executeVote: false,


	customFilter: false,
	filters: {
		//1 - open, 2 - closed, 3 - all
		status: 3,
		//1 - passed, 2 - rejected, 3 - enacted, 4 - pending, 5 - all
		outcome: 5,
		//1 - Voting, 2 - Parameter, 3 - all
		app: 3,
	},
})

export async function init() {
	// Initiates the connection to an organization
	let org = await connect('0xDcbd15991f5F6107150F4c6132849B9a26758e74', 'thegraph', { chainId: 4 })

	state.org = org

	// Fetch the apps belonging to this organization
	let apps = await org.apps()
	console.log(apps, "THE APPS")
	state.apps = apps

	state.ownershipVotingApp = apps.find(app => app.address.toLowerCase() 
										== OWNERSHIP_APP_ADDRESS.toLowerCase())
	state.parameterVotingApp = apps.find(app => app.address.toLowerCase() 
										== PARAMETER_APP_ADDRESS.toLowerCase())

	state.votingApps = [OWNERSHIP_APP_ADDRESS, PARAMETER_APP_ADDRESS]

	console.log(state.ownershipVotingApp, "OWNERSHIP VOTING APP")

	state.votingEscrow = new contract.web3.eth.Contract(allabis.votingescrow_abi, allabis.votingescrow_address)

	window.votingEscrow = state.votingEscrow

	state.initialized = true
	
}

if(!state.org) init()


export let contractMap = {
	[allabis.poolproxy_address]: 'Pool Proxy',
	[allabis.votingescrow_address]: 'Voting Escrow',
	[allabis.gaugecontroller_address]: 'Gauge Controller',
}

export async function getAllVotes() {
	const aragon_voting_subgraph_url = VOTING_SUBGRAPH_URL

	console.log(contract.default_account, "DEFAULT ACCOUNT")

	let getUserVotes = gql`
		fragment vote_cast on Vote {
			casts(where: { voter: "${contract.default_account}"}) {
		      id
		      voteId
		      voteNum
		      voter
		      supports
		      voterStake
		    }
		}
	`


	if(!contract.default_account)
		getUserVotes = null

	const QUERY = gql`
		{
		  votes(where:{
		    appAddress_in: ["${OWNERSHIP_APP_ADDRESS}", "${PARAMETER_APP_ADDRESS}"]
		  }, orderBy: startDate, orderDirection: desc) {
		    id
	      	appAddress
	      	orgAddress
	      	creator
	      	metadata
	      	executed
	      	startDate
	      	snapshotBlock
	      	supportRequiredPct
	      	minAcceptQuorum
	      	yea
	      	nay
	      	votingPower
	      	script
	      	creatorVotingPower
	      	transactionHash
	      	${getUserVotes !== null ? '...vote_cast' : ''}
		  }
		}
		${getUserVotes !== null ? getUserVotes : ''}
	`

	const lastCreatedVoteQuery = gql`
		query {
		  lastCreated: votes(where: {
		  	appAddress_in: ["${OWNERSHIP_APP_ADDRESS}", "${PARAMETER_APP_ADDRESS}"],
		  	creator: "${contract.default_account}"
		  }) {
		  	appAddress
		    startDate
		  }
		}
	`


	const wrapper = new GraphQLWrapper(VOTING_SUBGRAPH_URL)

	// Invoke the custom query and receive data
	const results = await Promise.all([wrapper.performQuery(QUERY), wrapper.performQuery(lastCreatedVoteQuery)])


	let { votes } = results[0].data
	let { lastCreated } = results[1].data

	console.log(votes, lastCreated, "VOTES LAST CREATED")

	state.votes = decorateVotes(votes)

	lastCreated = groupBy(lastCreated.sort((a,b) => a.startDate - b.startDate), 'appAddress')
	lastCreated = Object.fromEntries(Object.entries(lastCreated).map(([k, v]) => [k, v[0].startDate])) 
	state.lastCreated = lastCreated

	console.log(state.lastCreated, "LAST CREATED")

	state.votes.map(vote => decodeCall(vote))

	console.log("RESOLVED")
}

export function changeFilter() {
	state.customFilter = true
}

export async function getVote(app, voteId) {
	app = app.toLowerCase()
	app = getVotingAppAddress(app).toLowerCase()

	voteId = Number(voteId).toString(16)

	voteId = 'appAddress:' + app + '-voteId:0x' + voteId

	console.log(voteId, "THE VOTE ID")

	const aragon_voting_subgraph_url = VOTING_SUBGRAPH_URL

	console.log(contract.default_account, "DEFAULT ACCOUNT")

	let getUserVotes = gql`
		fragment vote_cast on Vote {
			casts(where: { voter: "${contract.default_account}"}) {
		      id
		      voteId
		      voteNum
		      voter
		      supports
		      voterStake
		    }
		}
	`

	let getLastUserVote = gql`
		query {
			lastUserVote: votes(where: { id: "${voteId}", creator: "${contract.default_account}"}, orderBy: startDate, orderDirection: desc, first:1) {
			    startDate
		  	}
	  	}
	`


	if(!contract.default_account) {
		getUserVotes = null
		getLastUserVote = null
	}


	const QUERY = gql`
		query {
		  votes(where:{
		    id: "${voteId}"
		  }, orderBy: startDate, orderDirection: desc) {
		    id
	      	appAddress
	      	orgAddress
	      	creator
	      	metadata
	      	executed
	      	startDate
	      	snapshotBlock
	      	supportRequiredPct
	      	minAcceptQuorum
	      	yea
	      	nay
	      	votingPower
	      	script
	      	transactionHash
	      	${getUserVotes !== null ? '...vote_cast' : ''}
		  }
		}
		${getUserVotes !== null ? getUserVotes : ''}
	`

	const wrapper = new GraphQLWrapper(VOTING_SUBGRAPH_URL)

	// Invoke the custom query and receive data
	const results = await Promise.all([wrapper.performQuery(QUERY), wrapper.performQuery(getLastUserVote)])

	let { votes } = results[0].data


	let { lastUserVote } = results[1].data

	console.log(votes, "THE VOTE")

	let vote = state.votes.length && state.votes.find(vote => vote.id == votes[0].id)
	if(vote === undefined || vote == 0) {
		state.votes.push(vote)
		vote = votes[0]
	}

	decorateVotes([vote])

	decodeCall(vote)

	return vote

}

export function decorateVotes(votes) {
	return votes.map(vote => {
		let time = OWNERSHIP_VOTE_TIME
		if(vote.appAddress == PARAMETER_APP_ADDRESS)
			time = PARAMETER_VOTE_TIME

		vote.time = time
		vote.timeLeft = time - ((new Date().getTime() / 1000) - vote.startDate)
		vote.totalSupport = +vote.yea + +vote.nay
		vote.voteNumber = getVoteId(vote)
		vote.votingAppName = getVotingAppName(vote.appAddress)
		if(vote.votingAppName == 'Ownership')
			vote.app = 1
		if(vote.votingAppName == 'Parameter')
			vote.app = 2
		vote.yeap = vote.totalSupport == 0 ? 0 : (+vote.yea / vote.totalSupport * 100).toFixed(1)
		vote.nop = vote.totalSupport == 0 ? 0 : (+vote.nay / vote.totalSupport * 100).toFixed(1)
		vote.callAddress = vote.script.substr(90,40).toLowerCase()
		vote.contractCalled = contractCalled(vote)
		vote.contractName = contractName(vote)
		if(isVoteOpen(vote) && !vote.executed)
			vote.status = 1
		if(!isVoteOpen(vote) || vote.executed)
			vote.status = 2
		if(vote.status == 1)
			vote.outcome = 4
		if(vote.executed)
			vote.outcome = 3
		if(isRejected(vote))
			vote.outcome = 2
		if(!vote.executed && canExecute(vote))
			vote.outcome = 1
		return vote
	})
}

export function contractCalled(vote) {
	if(vote.callAddress == allabis.poolproxy_address.substr(2).toLowerCase()) 
		return 'poolproxy'
	if(vote.callAddress == allabis.votingescrow_address.substr(2).toLowerCase()) 
		return 'votingescrow'
	if(vote.callAddress == allabis.gaugecontroller_address.substr(2).toLowerCase()) 
		return 'gaugecontroller'
	if(ALL_POOLS.map(address => address.substr(2).toLowerCase()).includes(vote.callAddress))
		return 'pool'
	return null
}

export function contractName(vote) {
	if(contractCalled(vote) == 'poolproxy') 
		return 'Pool Proxy'
	if(contractCalled(vote) == 'votingescrow')
		return 'Voting Escrow'
	if(contractCalled(vote) == 'gaugecontroller')
		return 'Gauge Controller'
	if(contractCalled(vote) == 'pool') {
		return Object.keys(poolAbis).find(pool => poolAbis[pool].swap_address.substr(2).toLowerCase() == vote.callAddress)
	}
	return null
}

export async function decodeCall(vote) {
	let desc
	if(vote.contractCalled !== null) {
		let natspec = allabis[vote.contractCalled+'_natspec'].methods
		let abi = allabis[vote.contractCalled+'_abi']
		let signature = '0x'+vote.script.substr(322, 8)
		let method = Object.keys(natspec).find(key => web3.eth.abi.encodeFunctionSignature(key) == signature)
		// let signatures = Object.values(natspec).map(m => m.signature.substr(2))
		// let match = signatures.map(sig => this.vote.script.indexOf(sig)).find(idx => idx > -1)
		// let method = Object.keys(natspec).find(key => 
		// 	natspec[key].signature.substr(2) == signatures.filter(sig => this.vote.script.indexOf(sig) > -1))
		// if(method === undefined) return null;
		// let data = this.vote.script.substr(match)
		let data = vote.script.substr(322)
		let expression = natspec[method].notice
		let call = {
			abi: [abi.find(v => v.name == method.split('(')[0])],
			transaction: {
				data: '0x' + data,
			}
		}
		desc = await radspec.evaluate(expression, call, radspecFormat)
	}
	else if(!vote.metadata) {
		try {
			desc = await describeScript(vote.script, state.apps)
			desc = desc[0].description
		}
		catch(err) {
			console.error(err)
		}
	}
	Vue.set(vote, 'description', desc)
}

export function getVotingAppName(address) {
	if(address.toLowerCase() == OWNERSHIP_APP_ADDRESS.toLowerCase()) return 'Ownership'
	if(address.toLowerCase() == PARAMETER_APP_ADDRESS.toLowerCase()) return 'Parameter'
	if(address.toLowerCase() == OWNERSHIP_AGENT.toLowerCase()) return 'Ownership Agent'
	if(address.toLowerCase() == PARAMETER_AGENT.toLowerCase()) return 'Parameter Agent'
}

export function getSupportQuorum(appName) {
	if(appName.toLowerCase().includes('ownership'))
		return {
			support: 51, quorum: 50,
		}
	if(appName.toLowerCase().includes('parameter'))
		return {
			support: 70, quorum: 15,
		}
}

export function getVotingAppAddress(app) {
	if(app == 'ownership') return OWNERSHIP_APP_ADDRESS
	if(app == 'parameter') return PARAMETER_APP_ADDRESS
}

export function getVoteId(vote) {
	return +vote.id.split(':')[2]
}

export async function canCreateNewVoteOn(appAddress) {
	let now = Date.now() / 1000
	console.log(state.votingEscrow, "VOTING ESCROW")
	let balance = await state.votingEscrow.methods.balanceOf(contract.default_account).call()
	balance = BN(balance)
	console.log(balance, "MY BALANCE")
	return balance.gt(BN(MIN_BALANCE)) && (now - MIN_TIME) > +state.lastCreated[appAddress.toLowerCase()]
}

export async function canCreateNewVote() {
	// if(!contract.default_account) return false
	// let balance = await state.votingEscrow.methods.balanceOf(contract.default_account).call()
	// balance = BN(balance)
	// return balance.gt(BN(MIN_BALANCE))

	return canCreateNewVoteOn(OWNERSHIP_APP_ADDRESS) || canCreateNewVoteOn(PARAMETER_APP_ADDRESS)
}

// export function getVote(id) {

// 	//also get the last time user voted
// }

export function isExecuted(vote) {
	return vote.executed
}

export function hasSupport(vote) {
	return isValuePct(vote.yea, vote.votingPower, vote.supportRequiredPct)
}

export function hasQuorum(vote) {
	return isValuePct(vote.yea, vote.votingPower, vote.minAcceptQuorumPct)
}

export function canExecute(vote) {
	if(vote.executed)
		return false

    // Voting is already decided
	if(hasSupport(vote))
		return true
        
	// Vote ended?
	if(isVoteOpen(vote))
		return false

	// Vote ended?
	let totalVotes = BN(vote.yea).plus(vote.nay)
	if (!isValuePct(vote.yea, totalVotes, vote.supportRequiredPct))
        return false;

    // Has min quorum?
    if (!isValuePct(vote.yea, vote.votingPower, vote.minAcceptQuorumPct))
        return false;

    return true;
}

export function isRejected(vote) {
	return !vote.executed && !isVoteOpen(vote) && (!hasSupport(vote) || !hasQuorum(vote)) && !canExecute(vote)
}

export function canVote(vote, voter) {
	//add min time check
    return isVoteOpen(vote) && votingEscrow.methods.balanceOfAt(voter, vote.snapshotBlock) > 0;
}

export function isValuePct(_value, _total, _pct) {
        if (_total == 0) {
            return false;
        }

        let computedPct = BN(_value).times(10**18).div(_total);
        return computedPct.gt(_pct);
    }


export function isVoteOpen(vote) {
	let time = OWNERSHIP_VOTE_TIME
	if(vote.appAddress == PARAMETER_APP_ADDRESS)
		time = PARAMETER_VOTE_TIME
	return vote.startDate > (new Date().getTime() / 1000) - time
}

export function encodeCallsScript(actions) {
  return actions.reduce((script, { to, data }) => {
    const address = web3.eth.abi.encodeParameter('address', to)
    const dataLength = web3.eth.abi.encodeParameter('uint256', (data.length - 2) / 2).toString('hex')

    return script + address.slice(26) + dataLength.slice(58) + data.slice(2)
  }, CALLSCRIPT_ID)
}


export let getters = {
	votes() {
		return state.votes
	},
	openVotes() {
		return state.votes.filter(vote => isVoteOpen(vote) && !vote.executed).sort((a, b) => b.creatorVotingPower - a.creatorVotingPower)
	},
	closedVotes() {
		return state.votes.filter(vote => !isVoteOpen(vote) || vote.executed)
	},
	customFilter() {
		return state.customFilter
	},
	customFilterVotes() {
		let filteredVotes = state.votes
		if(state.filters.status < 3)
			filteredVotes = filteredVotes.filter(vote => vote.status == state.filters.status)
		if(state.filters.outcome < 5)
			filteredVotes = filteredVotes.filter(vote => vote.outcome == state.filters.outcome)
		if(state.filters.app < 3)
			filteredVotes = filteredVotes.filter(vote => vote.app == state.filters.app)
		console.log(filteredVotes, "FILTERED VOTES")
		return filteredVotes
	},
}

export let helpers = {
	isVoteOpen, canExecute, isRejected, canCreateNewVote, canCreateNewVoteOn, encodeCallsScript,
}

export function shortenAddress(address) {
	if(!address) return ''
	return address.slice(0,6) + '...' + address.slice(-6)
}