"""Pure research classification decisions from visual probabilities only."""
def hierarchy_decision(utility,technology,utility_threshold,technology_threshold):
    u=sorted(utility,key=utility.get,reverse=True);t=sorted(technology,key=technology.get,reverse=True)
    if (u[0]=='not_meter' or utility[u[0]]<utility_threshold or technology[t[0]]<technology_threshold
            or utility[u[0]]-utility[u[1]]<.1 or technology[t[0]]-technology[t[1]]<.1):return 'unknown'
    return u[0]+'_'+t[0]
